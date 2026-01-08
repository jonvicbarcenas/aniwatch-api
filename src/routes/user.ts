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

/**
 * Admin: get most recent watchers across all users.
 * 
 * GET /admin/recent-watchers?uid=<adminUid>&limit=25&activeWithinMinutes=5
 * - Returns latest watch item per user (deduplicated by uid)
 * - Auth model matches settings route (trusts provided uid; production should verify Firebase token)
 */
userRouter.get("/admin/recent-watchers", async (c) => {
    const uid = c.req.query("uid");
    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    const limitRaw = c.req.query("limit");
    const activeWithinRaw = c.req.query("activeWithinMinutes");

    const limit = Math.min(Math.max(Number(limitRaw ?? 25) || 25, 1), 200);
    const activeWithinMinutes = activeWithinRaw ? Number(activeWithinRaw) : undefined;
    const activeSince = Number.isFinite(activeWithinMinutes)
        ? Date.now() - Math.max(activeWithinMinutes!, 0) * 60_000
        : undefined;

    const db = await getDB();

    // Authorization: only admins can read this.
    const user = await db.collection("users").findOne({ uid });
    if (!user || user.isAdmin !== true) {
        return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    const matchStage: Record<string, unknown> = {};
    if (Number.isFinite(activeSince)) {
        matchStage.watchedAt = { $gte: activeSince };
    }

    // watchHistory stores items keyed by (uid, animeId, episodeNum) with watchedAt updates.
    // We want the most recent row per uid.
    const pipeline: any[] = [];
    if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });

    pipeline.push(
        { $sort: { watchedAt: -1 } },
        {
            $group: {
                _id: "$uid",
                uid: { $first: "$uid" },
                animeId: { $first: "$animeId" },
                name: { $first: "$name" },
                image: { $first: "$image" },
                type: { $first: "$type" },
                episodeNum: { $first: "$episodeNum" },
                episodeId: { $first: "$episodeId" },
                watchedAt: { $first: "$watchedAt" },
                timeWatched: { $first: "$timeWatched" },
                duration: { $first: "$duration" },
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "uid",
                foreignField: "uid",
                as: "user",
            },
        },
        {
            $addFields: {
                username: { $ifNull: [{ $arrayElemAt: ["$user.username", 0] }, "unknown"] },
            },
        },
        {
            $project: {
                _id: 0,
                uid: 1,
                username: 1,
                animeId: 1,
                name: 1,
                image: 1,
                type: 1,
                episodeNum: 1,
                episodeId: 1,
                watchedAt: 1,
                timeWatched: 1,
                duration: 1,
            },
        },
        { $sort: { watchedAt: -1 } },
        { $limit: limit }
    );

    const items = await db.collection("watchHistory").aggregate(pipeline).toArray();
    return c.json({ success: true, data: items });
});
