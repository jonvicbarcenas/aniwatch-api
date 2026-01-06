import { Hono } from "hono";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";

export const userRouter = new Hono<ServerContext>();

// Get user profile by uid
userRouter.get("/profile/:uid", async (c) => {
    const { uid } = c.req.param();
    const db = await getDB();
    const profile = await db.collection("users").findOne({ uid });
    return c.json({ success: true, data: profile });
});

// Get user profile by username (case-insensitive)
userRouter.get("/profile/by-username/:username", async (c) => {
    const { username } = c.req.param();
    const uname = String(username).trim();
    const escaped = uname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped}$`, "i");
    const db = await getDB();
    const profile = await db.collection("users").findOne({ username: { $regex: regex } });
    return c.json({ success: true, data: profile });
});

// Create/Update user profile with username uniqueness enforcement (case-insensitive)
userRouter.post("/profile", async (c) => {
    const body = await c.req.json();
    const { uid, username, ...profileData } = body;
    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    const db = await getDB();

    let finalUsername: string | undefined = undefined;
    if (typeof username === "string" && username.trim()) {
        const uname = username.trim();
        const escaped = uname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`^${escaped}$`, "i");
        const existing = await db
            .collection("users")
            .findOne({ username: { $regex: regex }, uid: { $ne: uid } });
        if (existing) {
            return c.json({ success: false, error: "username-taken" }, 409);
        }
        // Normalize to lowercase when storing
        finalUsername = uname.toLowerCase();
    }

    await db.collection("users").updateOne(
        { uid },
        {
            $set: {
                ...profileData,
                uid,
                ...(finalUsername ? { username: finalUsername } : {}),
                updatedAt: Date.now(),
            },
        },
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

// Add/Update watchlist item
userRouter.post("/watchlist", async (c) => {
    const body = await c.req.json();
    const { uid, animeId, ...itemData } = body;
    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    const db = await getDB();
    await db.collection("watchlist").updateOne(
        { uid, animeId },
        { 
            $set: { ...itemData, uid, animeId, updatedAt: Date.now() },
            $setOnInsert: { addedAt: Date.now() }
        },
        { upsert: true }
    );
    return c.json({ success: true });
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

// Remove specific history item
userRouter.delete("/history/:uid/:animeId/:episodeNum", async (c) => {
    const { uid, animeId, episodeNum } = c.req.param();
    const db = await getDB();
    await db.collection("watchHistory").deleteOne({ 
        uid, 
        animeId, 
        episodeNum: parseInt(episodeNum) 
    });
    return c.json({ success: true });
});
