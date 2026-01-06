import { Hono } from "hono";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";

export const chatRouter = new Hono<ServerContext>();

// Disable caching for chat
chatRouter.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
});

/**
 * Chat read receipts and unread count
 */
// Mark messages as seen up to a timestamp
chatRouter.post("/messages/seen", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { userId, username, upToCreatedAt } = body as { userId?: string; username?: string; upToCreatedAt?: number };
    if (!userId || !username || !Number.isFinite(upToCreatedAt)) {
        return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    const db = await getDB();
    await db.collection("chatMessages").updateMany(
        { createdAt: { $lte: upToCreatedAt! } },
        {
            $addToSet: { seenBy: { userId, username } },
        }
    );

    return c.json({ success: true });
});

// Unread count for a user
chatRouter.get("/unread-count", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) return c.json({ success: false, error: "userId required" }, 400);
    const db = await getDB();
    const count = await db.collection("chatMessages").countDocuments({
        $or: [
            { seenBy: { $exists: false } },
            { seenBy: { $size: 0 } },
            { seenBy: { $not: { $elemMatch: { userId } } } },
        ],
    });
    return c.json({ success: true, data: { count } });
});

/**
 * Global chat messages.
 *
 * GET /messages?limit=50&after=<ms>&before=<ms>
 * - `after`: return messages with createdAt > after
 * - `before`: return messages with createdAt < before (useful for pagination)
 * Server returns messages sorted ascending by createdAt.
 */
chatRouter.get("/messages", async (c) => {
    const limitParam = c.req.query("limit");
    const afterParam = c.req.query("after");
    const beforeParam = c.req.query("before");

    const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);
    const after = afterParam ? Number(afterParam) : undefined;
    const before = beforeParam ? Number(beforeParam) : undefined;

    const createdAtQuery: Record<string, number> = {};
    if (Number.isFinite(after)) createdAtQuery.$gt = after!;
    if (Number.isFinite(before)) createdAtQuery.$lt = before!;

    const query: Record<string, unknown> = {};
    if (Object.keys(createdAtQuery).length > 0) {
        query.createdAt = createdAtQuery;
    }

    const db = await getDB();

    // Fetch newest first, then reverse to ascending for chat UI.
    const docs = await db
        .collection("chatMessages")
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

    const messages = docs
        .map((m) => ({
            ...m,
            _id: m._id.toString(),
        }))
        .reverse();

    return c.json({ success: true, data: messages });
});

chatRouter.post("/messages", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    const { userId, username, userAvatar, text } = body as {
        userId?: string;
        username?: string;
        userAvatar?: string;
        text?: string;
    };

    if (!userId || !username || !text) {
        return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    const trimmed = String(text).trim();
    if (!trimmed) {
        return c.json({ success: false, error: "Message cannot be empty" }, 400);
    }

    if (trimmed.length > 500) {
        return c.json({ success: false, error: "Message exceeds 500 character limit" }, 400);
    }

    const message = {
        userId,
        username,
        userAvatar: userAvatar || null,
        text: trimmed,
        createdAt: Date.now(),
    };

    const db = await getDB();
    const result = await db.collection("chatMessages").insertOne(message);

    return c.json({
        success: true,
        data: { ...message, _id: result.insertedId.toString() },
    });
});
