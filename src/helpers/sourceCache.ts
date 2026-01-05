import type { Db } from "mongodb";

export type EpisodeCategory = "sub" | "dub" | "raw";

export interface CachedEpisodeSourcesDoc {
    _id: string;
    animeEpisodeId: string;
    server: string;
    category: EpisodeCategory;

    /** Raw payload returned by the aniwatch scraper */
    data: unknown;

    createdAt: Date;
    updatedAt: Date;
}

const COLLECTION = "episodeSourcesCache";

export function makeEpisodeSourcesCacheId(
    animeEpisodeId: string,
    server: string,
    category: EpisodeCategory
) {
    return `${animeEpisodeId}::${category}::${server}`;
}

export async function ensureEpisodeSourcesCacheIndexes(db: Db) {
    // Unique key already covered by _id, but keep a helpful query index as well.
    await db.collection<CachedEpisodeSourcesDoc>(COLLECTION).createIndex(
        { animeEpisodeId: 1, category: 1, server: 1 },
        { name: "episode_sources_lookup" }
    );
    await db
        .collection<CachedEpisodeSourcesDoc>(COLLECTION)
        .createIndex({ updatedAt: -1 }, { name: "episode_sources_updatedAt" });
}

export async function getCachedEpisodeSources<T = unknown>(
    db: Db,
    animeEpisodeId: string,
    server: string,
    category: EpisodeCategory
): Promise<T | null> {
    const _id = makeEpisodeSourcesCacheId(animeEpisodeId, server, category);
    const doc = await db.collection<CachedEpisodeSourcesDoc>(COLLECTION).findOne({ _id });
    return (doc?.data as T) ?? null;
}

/**
 * Only call this after a successful upstream fetch.
 */
export async function setCachedEpisodeSources(
    db: Db,
    animeEpisodeId: string,
    server: string,
    category: EpisodeCategory,
    data: unknown
) {
    const _id = makeEpisodeSourcesCacheId(animeEpisodeId, server, category);
    const now = new Date();

    await db.collection<CachedEpisodeSourcesDoc>(COLLECTION).updateOne(
        { _id },
        {
            $set: {
                animeEpisodeId,
                server,
                category,
                data,
                updatedAt: now,
            },
            $setOnInsert: {
                createdAt: now,
            },
        },
        { upsert: true }
    );
}
