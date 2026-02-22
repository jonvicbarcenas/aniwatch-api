import type { Db } from "mongodb";
import { cache } from "../config/cache.js";

export type PublicUserProfile = {
  uid: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

const PROFILE_TTL_SECONDS = 5 * 60; // 5 minutes

function profileCacheKey(uid: string) {
  return `user:profile:${uid}`;
}

function toPublicProfile(doc: any | null): PublicUserProfile | null {
  if (!doc) return null;
  return {
    uid: String(doc.uid),
    username: doc.username ?? null,
    displayName: doc.displayName ?? null,
    avatarUrl: doc.avatarUrl ?? null,
  };
}

export async function getProfile(db: Db, uid: string): Promise<PublicUserProfile | null> {
  const key = profileCacheKey(uid);
  return await cache.getOrSet(async () => {
    const doc = await db.collection("users").findOne({ uid });
    return toPublicProfile(doc);
  }, key, PROFILE_TTL_SECONDS);
}

export async function getProfilesBatch(db: Db, uids: string[]): Promise<Record<string, PublicUserProfile | null>> {
  const unique = Array.from(new Set(uids.filter(Boolean)));
  const result: Record<string, PublicUserProfile | null> = {};
  if (unique.length === 0) return result;

  const anyCache = cache as unknown as { enabled?: boolean; client?: any };

  let cachedMap: Record<string, PublicUserProfile | null> = {};
  const misses: string[] = [];

  if (anyCache?.enabled && anyCache.client) {
    const keys = unique.map(profileCacheKey);
    const values = await anyCache.client.mget(keys);
    for (let i = 0; i < unique.length; i++) {
      const uid = unique[i];
      const raw = values?.[i];
      if (raw) {
        try {
          cachedMap[uid] = JSON.parse(raw);
        } catch {
          cachedMap[uid] = null;
          misses.push(uid);
        }
      } else {
        misses.push(uid);
      }
    }
  } else {
    // Cache disabled: everything is a miss
    misses.push(...unique);
  }

  // Fetch misses from DB
  if (misses.length) {
    const docs = await db
      .collection("users")
      .find({ uid: { $in: misses } })
      .toArray();

    const mapFromDb: Record<string, PublicUserProfile | null> = {};
    for (const doc of docs) {
      const p = toPublicProfile(doc);
      if (p) mapFromDb[p.uid] = p;
    }
    for (const uid of misses) {
      if (!(uid in mapFromDb)) mapFromDb[uid] = null;
    }

    // Backfill cache for misses
    if (anyCache?.enabled && anyCache.client) {
      const pipeline = anyCache.client.multi();
      for (const uid of misses) {
        const key = profileCacheKey(uid);
        pipeline.setex(key, PROFILE_TTL_SECONDS, JSON.stringify(mapFromDb[uid]));
      }
      await pipeline.exec();
    }

    cachedMap = { ...cachedMap, ...mapFromDb };
  }

  // Build final result aligned to input uids order
  for (const uid of unique) {
    result[uid] = cachedMap[uid] ?? null;
  }
  return result;
}

export async function invalidateProfileCache(uid: string): Promise<void> {
  try {
    const anyCache = cache as unknown as { enabled?: boolean; client?: any };
    if (!anyCache?.enabled || !anyCache?.client) return;
    await anyCache.client.del(profileCacheKey(uid));
  } catch (err) {
    console.warn("Profile cache invalidation failed:", (err as Error)?.message || err);
  }
}
