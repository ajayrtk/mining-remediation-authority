import type { Handle } from '@sveltejs/kit';
import { type SessionCookie, fetchUserProfile, refreshTokens } from '$lib/server/cognito';
import { getSession, updateSession, deleteSession } from '$lib/server/session-store';

const SESSION_COOKIE = 'mapml-session';


const cookieOptions = (event: Parameters<Handle>[0]['event']) => ({
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: event.url.protocol === 'https:',
	path: '/',
	maxAge: 60 * 60 * 24 * 7 // one week, refresh will extend
});

export const handle: Handle = async ({ event, resolve }) => {
	const redirectUri = `${event.url.origin}/auth/callback`;
	const sessionId = event.cookies.get(SESSION_COOKIE);
	let session = sessionId ? getSession(sessionId) : null;
	let sessionWasUpdated = false;
	let sessionWasCleared = false;

	if (session && session.expiresAt <= Date.now()) {
		if (session.refreshToken) {
			try {
				const refreshed = await refreshTokens(session.refreshToken, event.fetch, redirectUri);
				const expiresAt = Date.now() + refreshed.expires_in * 1000 - 60_000; // 1 min margin
				const user = await fetchUserProfile(refreshed.access_token, event.fetch);
				session = {
					expiresAt,
					accessToken: refreshed.access_token,
					refreshToken: session.refreshToken,
					idToken: refreshed.id_token,
					user
				};
				sessionWasUpdated = true;
			} catch (err) {
				console.error('Failed to refresh Cognito session', err);
				session = null;
				sessionWasCleared = true;
			}
		} else {
			session = null;
			sessionWasCleared = true;
		}
	}

	event.locals.user = session?.user ?? null;

	const response = await resolve(event);

	if (session && sessionWasUpdated && sessionId) {
		updateSession(sessionId, session);
	} else if (!session && sessionWasCleared && sessionId) {
		deleteSession(sessionId);
		event.cookies.delete(SESSION_COOKIE, { ...cookieOptions(event), maxAge: undefined });
	}

	return response;
};
