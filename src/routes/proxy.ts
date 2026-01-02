import { Hono } from "hono";
import type { ServerContext } from "../config/context.js";

const proxyRouter = new Hono<ServerContext>();

proxyRouter.get("/", async (c) => {
    const url = c.req.query("url");
    const referer = c.req.query("referer");

    if (!url) {
        return c.text("URL required", 400);
    }

    try {
        const headers: HeadersInit = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        };
        if (referer) {
            headers["Referer"] = referer;
            try {
                const u = new URL(referer);
                headers["Origin"] = `${u.protocol}//${u.host}`;
            } catch (e) {
                // ignore invalid referer url for Origin
            }
        }

        const response = await fetch(url, {
            headers,
            method: 'GET'
        });

        if (!response.ok) {
            return c.text(`Error fetching remote resource: ${response.status}`, response.status as any);
        }

        const contentType = response.headers.get("content-type") || "";
        
        // Handle M3U8
        if (contentType.includes("mpegurl") || contentType.includes("application/x-mpegURL") || url.includes(".m3u8")) {
            const text = await response.text();
            const lines = text.split("\n");
            const newLines: string[] = [];

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;

                if (line.startsWith("#")) {
                    newLines.push(line);
                } else {
                    // It's a URI. Resolve it.
                    const absoluteUrl = new URL(line, url).toString();
                    // Rewrite to point back to this proxy
                    // We use `?url=` which is relative to the current path (api/v2/proxy)
                    // Hls.js loads this playlist from `.../api/v2/proxy?url=...`
                    // So relative links in the playlist are resolved against that.
                    // If we put just `?url=...`, it resolves to `.../api/v2/proxy?url=...` which is correct.
                    
                    const proxyUrl = `?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer || "")}`;
                    newLines.push(proxyUrl);
                }
            }

            return c.body(newLines.join("\n") as any, {
                status: response.status as any,
                headers: {
                    "Content-Type": contentType,
                    "Access-Control-Allow-Origin": "*"
                }
            });
        } else {
            // Stream binary data (TS segments)
            return c.body(response.body as any, {
                status: response.status as any,
                headers: {
                    "Content-Type": contentType,
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

    } catch (error: any) {
        return c.text(`Proxy Error: ${error.message}`, 500);
    }
});

export { proxyRouter };
