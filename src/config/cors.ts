import { cors } from "hono/cors";
import { env } from "./env.js";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:4000", "*"];

const allowedOrigins = env.ANIWATCH_API_CORS_ALLOWED_ORIGINS
    ? env.ANIWATCH_API_CORS_ALLOWED_ORIGINS.split(",")
    : DEFAULT_ALLOWED_ORIGINS;

const isWildcard = allowedOrigins.includes("*");

export const corsConfig = cors({
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 600,
    credentials: !isWildcard,
    origin: isWildcard ? "*" : allowedOrigins,
});
