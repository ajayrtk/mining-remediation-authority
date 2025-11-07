import { randomBytes } from 'crypto';
import type { SessionCookie } from './cognito';

// In-memory session store
// For production, consider using Redis or a database
const sessions = new Map<string, SessionCookie>();

// Clean up expired sessions every hour
setInterval(() => {
	const now = Date.now();
	for (const [id, session] of sessions.entries()) {
		if (session.expiresAt <= now) {
			sessions.delete(id);
		}
	}
}, 60 * 60 * 1000);

export const createSession = (session: SessionCookie): string => {
	const sessionId = randomBytes(32).toString('base64url');
	sessions.set(sessionId, session);
	return sessionId;
};

export const getSession = (sessionId: string): SessionCookie | null => {
	return sessions.get(sessionId) ?? null;
};

export const updateSession = (sessionId: string, session: SessionCookie): void => {
	sessions.set(sessionId, session);
};

export const deleteSession = (sessionId: string): void => {
	sessions.delete(sessionId);
};
