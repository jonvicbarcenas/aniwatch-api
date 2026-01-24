import { cors } from "hono/cors";
import { env } from "./env.js";
import { log } from "./logger.js";

/**
 * CORS Configuration
 * 
 * SECURITY NOTE:
 * - In production, ALWAYS set ANIWATCH_API_CORS_ALLOWED_ORIGINS to your specific domains
 * - Wildcard "*" should only be used in development
 * - Example: ANIWATCH_API_CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
 */

// Default to localhost only in development, no wildcard for better security
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://localhost:4000", "http://localhost:5173", "https://myronix.jvbarcenas.space", "https://myronix.strangled.net"];

const allowedOrigins = env.ANIWATCH_API_CORS_ALLOWED_ORIGINS
    ? env.ANIWATCH_API_CORS_ALLOWED_ORIGINS.split(",").map(origin => origin.trim())
    : DEFAULT_ALLOWED_ORIGINS;

const isWildcard = allowedOrigins.includes("*");

// Log a warning if wildcard is used in production
if (isWildcard && env.NODE_ENV === "production") {
    log.warn(
        "⚠️ SECURITY WARNING: CORS is configured with wildcard '*' in production. " +
        "This allows any website to make requests to your API. " +
        "Set ANIWATCH_API_CORS_ALLOWED_ORIGINS to your specific domains."
    );
}

export const corsConfig = cors({
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"], // Explicitly allow Authorization header for tokens
    maxAge: 600,
    credentials: !isWildcard,
    origin: isWildcard ? "*" : allowedOrigins,
});
