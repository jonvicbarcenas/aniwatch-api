import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { env } from "./env.js";
import { log } from "./logger.js";

let firebaseApp: App | null = null;
let firebaseAuth: Auth | null = null;

/**
 * Initialize Firebase Admin SDK.
 * Returns true if initialization was successful, false otherwise.
 */
export function initializeFirebaseAdmin(): boolean {
    // Already initialized
    if (firebaseApp) {
        return true;
    }

    // Check if already initialized by another module
    const existingApps = getApps();
    if (existingApps.length > 0) {
        firebaseApp = existingApps[0];
        firebaseAuth = getAuth(firebaseApp);
        return true;
    }

    // Check if Firebase credentials are configured
    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
        log.warn(
            "Firebase Admin SDK not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables to enable token verification."
        );
        return false;
    }

    try {
        // Handle private key - replace escaped newlines with actual newlines
        const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

        firebaseApp = initializeApp({
            credential: cert({
                projectId: env.FIREBASE_PROJECT_ID,
                clientEmail: env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey,
            }),
        });

        firebaseAuth = getAuth(firebaseApp);
        log.info("Firebase Admin SDK initialized successfully");
        return true;
    } catch (error) {
        log.error(`Failed to initialize Firebase Admin SDK: ${error instanceof Error ? error.message : error}`);
        return false;
    }
}

/**
 * Get the Firebase Auth instance.
 * Returns null if Firebase Admin SDK is not initialized.
 */
export function getFirebaseAuth(): Auth | null {
    return firebaseAuth;
}

/**
 * Verify a Firebase ID token and return the decoded token.
 * Returns null if verification fails or Firebase is not configured.
 */
export async function verifyIdToken(idToken: string): Promise<{
    uid: string;
    email?: string;
    name?: string;
} | null> {
    if (!firebaseAuth) {
        return null;
    }

    try {
        const decodedToken = await firebaseAuth.verifyIdToken(idToken, true);
        return {
            uid: decodedToken.uid,
            email: decodedToken.email,
            name: decodedToken.name,
        };
    } catch (error) {
        log.debug(`Token verification failed: ${error instanceof Error ? error.message : error}`);
        return null;
    }
}

/**
 * Check if Firebase Admin SDK is configured and ready.
 */
export function isFirebaseConfigured(): boolean {
    return firebaseAuth !== null;
}
