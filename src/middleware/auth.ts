import type { Context, Next } from "hono";
import type { ServerContext } from "../config/context.js";
import { verifyIdToken, isFirebaseConfigured } from "../config/firebase.js";
import { getDB } from "../config/mongodb.js";
import { log } from "../config/logger.js";

/**
 * Extended context variables for authenticated requests.
 */
export interface AuthVariables {
    /** The verified user's UID from Firebase token */
    uid: string;
    /** The verified user's email (if available) */
    email?: string;
    /** Whether the user is an admin */
    isAdmin: boolean;
}

/**
 * Extract the Bearer token from the Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
    return parts[1];
}

/**
 * Authentication middleware that verifies Firebase ID tokens.
 * 
 * This middleware:
 * 1. Extracts the Bearer token from the Authorization header
 * 2. Verifies the token with Firebase Admin SDK
 * 3. Sets the verified uid in the context for downstream handlers
 * 
 * If Firebase is not configured, it falls back to trusting the uid in the request body/query
 * (for backward compatibility during migration).
 */
export async function authMiddleware(c: Context<ServerContext>, next: Next) {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    if (isFirebaseConfigured() && token) {
        const decoded = await verifyIdToken(token);
        if (decoded) {
            c.set("uid", decoded.uid);
            c.set("email", decoded.email);

            // Check if user is admin
            try {
                const db = await getDB();
                const user = await db.collection("users").findOne({ uid: decoded.uid });
                c.set("isAdmin", user?.isAdmin === true);
            } catch {
                c.set("isAdmin", false);
            }

            return next();
        }
    }

    // Token not provided, invalid, or Firebase not configured
    return c.json({ success: false, error: "Invalid or missing authorization" }, 401);
}

/**
 * Optional authentication middleware.
 * Similar to authMiddleware but doesn't require authentication.
 * If a valid token is provided, it sets the uid; otherwise, continues without auth.
 */
export async function optionalAuthMiddleware(c: Context<ServerContext>, next: Next) {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    if (isFirebaseConfigured() && token) {
        const decoded = await verifyIdToken(token);
        if (decoded) {
            c.set("uid", decoded.uid);
            c.set("email", decoded.email);

            // Check if user is admin
            try {
                const db = await getDB();
                const user = await db.collection("users").findOne({ uid: decoded.uid });
                c.set("isAdmin", user?.isAdmin === true);
            } catch {
                c.set("isAdmin", false);
            }
        }
    }

    return next();
}

/**
 * Admin-only middleware.
 * Requires authentication AND admin privileges.
 */
export async function adminMiddleware(c: Context<ServerContext>, next: Next) {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    if (isFirebaseConfigured() && token) {
        const decoded = await verifyIdToken(token);
        if (decoded) {
            // Verify admin status
            try {
                const db = await getDB();
                const user = await db.collection("users").findOne({ uid: decoded.uid });
                if (!user || user.isAdmin !== true) {
                    return c.json({ success: false, error: "Unauthorized - Admin access required" }, 403);
                }

                c.set("uid", decoded.uid);
                c.set("email", decoded.email);
                c.set("isAdmin", true);
                return next();
            } catch (error) {
                log.error(`Admin check failed: ${error instanceof Error ? error.message : error}`);
                return c.json({ success: false, error: "Authorization check failed" }, 500);
            }
        }
    }

    return c.json({ success: false, error: "Invalid or missing authorization" }, 401);
}

/**
 * Helper to get the verified uid from context.
 * In authenticated routes, use this instead of reading uid from request body.
 */
export function getVerifiedUid(c: Context<ServerContext>): string | undefined {
    return c.get("uid");
}

/**
 * Helper to check if current user is admin.
 */
export function isAdmin(c: Context<ServerContext>): boolean {
    return c.get("isAdmin") === true;
}
