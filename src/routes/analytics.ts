import { Hono } from "hono";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";
import { adminMiddleware } from "../middleware/auth.js";

export const analyticsRouter = new Hono<ServerContext>();

/**
 * GET /admin/analytics/overview
 *
 * Returns high-level counts:
 *   totalUsers, activeNow (watched within last 5 min),
 *   activeToday (24 h), totalWatchSessions, totalComments, totalChatMessages
 *
 * All counts are computed via lightweight MongoDB countDocuments / distinct
 * so nothing is loaded into Node memory.
 */
analyticsRouter.get("/overview", adminMiddleware, async (c) => {
    const db = await getDB();
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60_000;
    const twentyFourHAgo = now - 24 * 60 * 60_000;

    // Run all counts in parallel — each is a single‑pass DB operation.
    const [
        totalUsers,
        activeNowUids,
        activeTodayUids,
        totalWatchSessions,
        totalComments,
        totalChatMessages,
    ] = await Promise.all([
        db.collection("users").countDocuments(),
        db.collection("watchHistory").distinct("uid", { watchedAt: { $gte: fiveMinAgo } }),
        db.collection("watchHistory").distinct("uid", { watchedAt: { $gte: twentyFourHAgo } }),
        db.collection("watchHistory").countDocuments(),
        db.collection("comments").countDocuments(),
        db.collection("chatMessages").countDocuments(),
    ]);

    return c.json({
        success: true,
        data: {
            totalUsers,
            activeNow: activeNowUids.length,
            activeToday: activeTodayUids.length,
            totalWatchSessions,
            totalComments,
            totalChatMessages,
        },
    });
});

/**
 * GET /watch-trends?days=7
 *
 * Returns an array of { date, count } objects — one per day for the last N days
 * (default 7, max 30).  Uses a $group aggregation so the DB does all the work.
 */
analyticsRouter.get("/watch-trends", adminMiddleware, async (c) => {
    const daysParam = c.req.query("days");
    const days = Math.min(Math.max(Number(daysParam ?? 7) || 7, 1), 30);

    const since = Date.now() - days * 24 * 60 * 60_000;
    const db = await getDB();

    const pipeline = [
        { $match: { watchedAt: { $gte: since } } },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: "%Y-%m-%d",
                        date: { $toDate: "$watchedAt" },
                    },
                },
                count: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 as const } },
        { $project: { _id: 0, date: "$_id", count: 1 } },
    ];

    const trends = await db.collection("watchHistory").aggregate(pipeline).toArray();
    return c.json({ success: true, data: trends });
});

/**
 * GET /admin/analytics/top-anime?limit=10
 *
 * Returns the top N most-watched anime ranked by number of watch history entries.
 */
analyticsRouter.get("/top-anime", adminMiddleware, async (c) => {
    const limitParam = c.req.query("limit");
    const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 50);
    const db = await getDB();

    const pipeline = [
        {
            $group: {
                _id: "$animeId",
                name: { $first: "$name" },
                image: { $first: "$image" },
                count: { $sum: 1 },
            },
        },
        { $sort: { count: -1 as const } },
        { $limit: limit },
        { $project: { _id: 0, animeId: "$_id", name: 1, image: 1, count: 1 } },
    ];

    const top = await db.collection("watchHistory").aggregate(pipeline).toArray();
    return c.json({ success: true, data: top });
});

/**
 * GET /admin/analytics/user-growth?days=30
 *
 * Returns new user registrations per day.
 * Relies on the `createdAt` (or `updatedAt` as fallback) timestamp in the users collection.
 */
analyticsRouter.get("/user-growth", adminMiddleware, async (c) => {
    const daysParam = c.req.query("days");
    const days = Math.min(Math.max(Number(daysParam ?? 30) || 30, 1), 90);

    const since = Date.now() - days * 24 * 60 * 60_000;
    const db = await getDB();

    const pipeline = [
        {
            $addFields: {
                ts: { $ifNull: ["$createdAt", "$updatedAt"] },
            },
        },
        { $match: { ts: { $gte: since } } },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: "%Y-%m-%d",
                        date: { $toDate: "$ts" },
                    },
                },
                count: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 as const } },
        { $project: { _id: 0, date: "$_id", count: 1 } },
    ];

    const growth = await db.collection("users").aggregate(pipeline).toArray();
    return c.json({ success: true, data: growth });
});

/**
 * GET /unique-viewers?limit=10
 *
 * Top anime ranked by **unique viewer count** (distinct UIDs),
 * which is more meaningful than raw watch-history entries.
 */
analyticsRouter.get("/unique-viewers", adminMiddleware, async (c) => {
    const limitParam = c.req.query("limit");
    const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 50);
    const db = await getDB();

    const pipeline = [
        {
            $group: {
                _id: { animeId: "$animeId", uid: "$uid" },
                name: { $first: "$name" },
                image: { $first: "$image" },
            },
        },
        {
            $group: {
                _id: "$_id.animeId",
                name: { $first: "$name" },
                image: { $first: "$image" },
                uniqueViewers: { $sum: 1 },
            },
        },
        { $sort: { uniqueViewers: -1 as const } },
        { $limit: limit },
        { $project: { _id: 0, animeId: "$_id", name: 1, image: 1, uniqueViewers: 1 } },
    ];

    const data = await db.collection("watchHistory").aggregate(pipeline).toArray();
    return c.json({ success: true, data });
});

/**
 * GET /peak-hours?days=7
 *
 * Returns an array of 24 objects (hours 0–23) with the total watch count
 * for each hour across the last N days.  Perfect for a heatmap / bar chart.
 */
analyticsRouter.get("/peak-hours", adminMiddleware, async (c) => {
    const daysParam = c.req.query("days");
    const days = Math.min(Math.max(Number(daysParam ?? 7) || 7, 1), 30);

    const since = Date.now() - days * 24 * 60 * 60_000;
    const db = await getDB();

    const pipeline = [
        { $match: { watchedAt: { $gte: since } } },
        {
            $group: {
                _id: { $hour: { $toDate: "$watchedAt" } },
                count: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 as const } },
        { $project: { _id: 0, hour: "$_id", count: 1 } },
    ];

    const raw = await db.collection("watchHistory").aggregate(pipeline).toArray();

    // Fill in missing hours with 0 so the frontend always gets 24 slots
    const byHour = new Map(raw.map((r: any) => [r.hour, r.count]));
    const data = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        count: (byHour.get(h) as number) ?? 0,
    }));

    return c.json({ success: true, data });
});
