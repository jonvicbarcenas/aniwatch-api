import { cache } from "../config/cache.js";
import type { Db } from "mongodb";

/**
 * Redis cache helper for chat messages
 * Uses short TTL (5-10 seconds) for real-time feel while reducing DB load
 */

const CHAT_CACHE_TTL = 10; // 10 seconds - good balance for chat
const UNREAD_CACHE_TTL = 15; // 15 seconds for unread counts

/**
 * Generate cache key for chat messages query
 */
export function makeChatMessagesCacheKey(
    limit: number,
    after?: number,
    before?: number
): string {
    const parts = [`chat:messages:limit:${limit}`];
    if (typeof after === 'number') parts.push(`after:${after}`);
    if (typeof before === 'number') parts.push(`before:${before}`);
    return parts.join(':');
}

/**
 * Generate cache key for unread count
 */
export function makeUnreadCountCacheKey(userId: string): string {
    return `chat:unread:${userId}`;
}

/**
 * Get cached chat messages or fetch from DB
 */
export async function getCachedChatMessages(
    db: Db,
    limit: number,
    after?: number,
    before?: number
): Promise<{ messages: any[]; hasMore: boolean }> {
    const cacheKey = makeChatMessagesCacheKey(limit, after, before);

    return await cache.getOrSet(
        async () => {
            // Fetch from MongoDB
            const createdAtQuery: Record<string, number> = {};
            if (Number.isFinite(after)) createdAtQuery.$gt = after!;
            if (Number.isFinite(before)) createdAtQuery.$lt = before!;

            const query: Record<string, unknown> = {};
            if (Object.keys(createdAtQuery).length > 0) {
                query.createdAt = createdAtQuery;
            }

            const docs = await db
                .collection("chatMessages")
                .find(query)
                .sort({ createdAt: -1 })
                .limit(limit + 1)
                .toArray();

            const hasMore = docs.length > limit;
            const messages = docs
                .slice(0, limit)
                .map((m) => ({
                    ...m,
                    _id: m._id.toString(),
                }))
                .reverse();

            return { messages, hasMore };
        },
        cacheKey,
        CHAT_CACHE_TTL
    );
}

/**
 * Get cached unread count or fetch from DB
 */
export async function getCachedUnreadCount(
    db: Db,
    userId: string
): Promise<number> {
    const cacheKey = makeUnreadCountCacheKey(userId);

    return await cache.getOrSet(
        async () => {
            const count = await db.collection("chatMessages").countDocuments({
                $or: [
                    { seenBy: { $exists: false } },
                    { seenBy: { $size: 0 } },
                    { seenBy: { $not: { $elemMatch: { userId } } } },
                ],
            });
            return count;
        },
        cacheKey,
        UNREAD_CACHE_TTL
    );
}

/**
 * Invalidate all chat message caches
 * Call this when a new message is posted
 */
export async function invalidateChatMessagesCache(): Promise<void> {
    // Since we can't easily get all cache keys, we'll rely on the short TTL
    // In production, you might want to use Redis SCAN to find and delete matching keys
    // For now, the 10-second TTL ensures stale data doesn't persist long
    console.info('Chat cache invalidation triggered (relying on TTL)');
}

/**
 * Invalidate unread count cache for a specific user
 * Call this when a user marks messages as seen
 */
export async function invalidateUnreadCountCache(userId: string): Promise<void> {
    // Note: cache class doesn't expose delete method, so we rely on TTL
    // You could extend the cache class to add a delete method if needed
    console.info(`Unread count cache invalidation triggered for user: ${userId}`);
}
