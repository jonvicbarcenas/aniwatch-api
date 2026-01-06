import { Hono } from "hono";
import type { ServerContext } from "../config/context.js";

const proxyRouter = new Hono<ServerContext>();

// In-memory cache with TTL
const cache = new Map<string, { data: string | Buffer; timestamp: number }>();
const CACHE_TTL_M3U8 = 10 * 60 * 1000; // 10 minutes for playlists
const CACHE_TTL_SEGMENT = 60 * 60 * 1000; // 1 hour for segments

function getCached(url: string): string | Buffer | null {
    const cached = cache.get(url);
    if (!cached) return null;
    
    const isM3U8 = url.endsWith(".m3u8");
    const ttl = isM3U8 ? CACHE_TTL_M3U8 : CACHE_TTL_SEGMENT;
    
    if (Date.now() - cached.timestamp > ttl) {
        cache.delete(url);
        return null;
    }
    return cached.data;
}

function setCache(url: string, data: string | Buffer): void {
    // Limit cache size to prevent memory issues
    if (cache.size > 1000) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
    }
    cache.set(url, { data, timestamp: Date.now() });
}

function rewritePlaylistUrls(playlistText: string, baseUrl: string, referer: string): string {
    const base = new URL(baseUrl);
    return playlistText
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("#") || trimmed === "") return line;

            try {
                const resolvedUrl = new URL(trimmed, base).href;
                return `?url=${encodeURIComponent(resolvedUrl)}&referer=${encodeURIComponent(referer)}`;
            } catch (e) {
                return line;
            }
        })
        .join("\n");
}

async function fetchWithCustomReferer(url: string, refererUrl: string): Promise<Response> {
    const headers: HeadersInit = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    };

    if (refererUrl) {
        headers["Referer"] = refererUrl;
        try {
            headers["Origin"] = new URL(refererUrl).origin;
        } catch (e) {
            // ignore invalid referer
        }
    }

    return fetch(url, {
        headers,
        redirect: 'follow',
    });
}

proxyRouter.get("/", async (c) => {
    const url = c.req.query("url");
    const referer = c.req.query("referer") || "https://megacloud.club/";

    if (!url) {
        return c.text("URL required", 400);
    }

    try {
        const isM3U8 = url.endsWith(".m3u8");

        // Check cache
        const cached = getCached(url);
        if (cached) {
            const contentType = isM3U8 ? "application/vnd.apple.mpegurl" : "video/mp2t";
            const cacheControl = isM3U8 ? "public, max-age=600" : "public, max-age=31536000";
            
            return c.body(cached as any, {
                status: 200,
                headers: {
                    "Content-Type": contentType,
                    "Cache-Control": cacheControl,
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        const response = await fetchWithCustomReferer(url, referer);

        if (!response.ok) {
            return c.text(`Error fetching remote resource: ${response.status}`, response.status as any);
        }

        if (isM3U8) {
            const playlistText = await response.text();
            const modifiedPlaylist = rewritePlaylistUrls(playlistText, url, referer);

            setCache(url, modifiedPlaylist);

            return c.body(modifiedPlaylist as any, {
                status: 200,
                headers: {
                    "Content-Type": "application/vnd.apple.mpegurl",
                    "Cache-Control": "public, max-age=600",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        } else {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            setCache(url, buffer);

            return c.body(buffer as any, {
                status: 200,
                headers: {
                    "Content-Type": "video/mp2t",
                    "Cache-Control": "public, max-age=31536000",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }
    } catch (error: any) {
        return c.text(`Proxy Error: ${error.message}`, 500);
    }
});

export { proxyRouter };
