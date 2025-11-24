import { randomBytes } from 'crypto';
import type { SessionCookie } from './cognito';

/**
 * WARNING: In-memory session store - NOT PRODUCTION READY
 *
 * LIMITATIONS:
 * - Sessions lost on server restart/redeploy
 * - Cannot scale horizontally (each instance has separate storage)
 * - No session persistence across deployments
 *
 * For production, implement persistent session storage using:
 * - Redis (recommended for performance)
 * - DynamoDB (for AWS-native solution)
 * - Database with TTL support
 */
const sessions = new Map<string, SessionCookie>();

// Track last cleanup time to avoid frequent cleanups
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Lazy cleanup of expired sessions (called on each session access)
 * More efficient than setInterval in serverless environments
 */
function cleanupExpiredSessions(): void {
	const now = Date.now();

	// Only cleanup if enough time has passed since last cleanup
	if (now - lastCleanup < CLEANUP_INTERVAL_MS) {
		return;
	}

	lastCleanup = now;

	for (const [id, session] of sessions.entries()) {
		if (session.expiresAt <= now) {
			sessions.delete(id);
		}
	}
}

export const createSession = (session: SessionCookie): string => {
	cleanupExpiredSessions();
	const sessionId = randomBytes(32).toString('base64url');
	sessions.set(sessionId, session);
	return sessionId;
};

export const getSession = (sessionId: string): SessionCookie | null => {
	cleanupExpiredSessions();
	return sessions.get(sessionId) ?? null;
};

export const updateSession = (sessionId: string, session: SessionCookie): void => {
	sessions.set(sessionId, session);
};

export const deleteSession = (sessionId: string): void => {
	sessions.delete(sessionId);
};
