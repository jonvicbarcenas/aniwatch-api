import { Hono } from "hono";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";

export const userRouter = new Hono<ServerContext>();

// Get user profile
userRouter.get("/profile/:uid", async (c) => {
    const { uid } = c.req.param();
    const db = await getDB();
    const profile = await db.collection("users").findOne({ uid });
    return c.json({ success: true, data: profile });
});

// Create/Update user profile
userRouter.post("/profile", async (c) => {
    const body = await c.req.json();
    const { uid, ...profileData } = body;
    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    const db = await getDB();
    await db.collection("users").updateOne(
        { uid },
        { $set: { ...profileData, uid, updatedAt: Date.now() } },
        { upsert: true }
    );
    return c.json({ success: true });
});

// Get watchlist
userRouter.get("/watchlist/:uid", async (c) => {
    const { uid } = c.req.param();
    const db = await getDB();
    const items = await db.collection("watchlist")
        .find({ uid })
        .sort({ addedAt: -1 })
        .toArray();
    return c.json({ success: true, data: items });
});

// Add to watchlist
userRouter.post("/watchlist", async (c) => {
    const body = await c.req.json();
    const { uid, ...itemData } = body;
    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    const db = await getDB();
    const result = await db.collection("watchlist").insertOne({
        ...itemData,
        uid,
        addedAt: Date.now(),
    });
    return c.json({ success: true, data: { id: result.insertedId } });
});

// Remove from watchlist
userRouter.delete("/watchlist/:uid/:animeId", async (c) => {
    const { uid, animeId } = c.req.param();
    const db = await getDB();
    await db.collection("watchlist").deleteOne({ uid, animeId });
    return c.json({ success: true });
});

// Get watch history
userRouter.get("/history/:uid", async (c) => {
    const { uid } = c.req.param();
    const db = await getDB();
    const items = await db.collection("watchHistory")
        .find({ uid })
        .sort({ watchedAt: -1 })
        .toArray();
    return c.json({ success: true, data: items });
});

// Add/Update watch history
userRouter.post("/history", async (c) => {
    const body = await c.req.json();
    const { uid, animeId, episodeNum, ...itemData } = body;
    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    const db = await getDB();
    await db.collection("watchHistory").updateOne(
        { uid, animeId, episodeNum },
        { $set: { ...itemData, uid, animeId, episodeNum, watchedAt: Date.now() } },
        { upsert: true }
    );
    return c.json({ success: true });
});

// Clear watch history
userRouter.delete("/history/:uid", async (c) => {
    const { uid } = c.req.param();
    const db = await getDB();
    await db.collection("watchHistory").deleteMany({ uid });
    return c.json({ success: true });
});
