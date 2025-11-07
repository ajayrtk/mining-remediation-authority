import { exchangeCodeForTokens, fetchUserProfile, type SessionCookie } from '$lib/server/cognito';
import { createSession } from '$lib/server/session-store';
import { redirect, error, type RequestHandler } from '@sveltejs/kit';

const SESSION_COOKIE = 'mapml-session';
const STATE_COOKIE = 'mapml-auth-state';

type AuthStateCookie = {
	state: string;
	redirectTo: string;
	codeVerifier?: string;
};

const decodeState = (raw: string | undefined): AuthStateCookie | null => {
	if (!raw) return null;
	try {
		const json = Buffer.from(raw, 'base64url').toString('utf8');
		return JSON.parse(json) as AuthStateCookie;
	} catch (err) {
		console.error('Invalid OAuth state cookie', err);
		return null;
	}
};


export const GET: RequestHandler = async ({ url, cookies, fetch }) => {
	const code = url.searchParams.get('code');
	const returnedState = url.searchParams.get('state');
	const stateCookie = decodeState(cookies.get(STATE_COOKIE));

	cookies.delete(STATE_COOKIE, {
		path: '/',
		sameSite: 'lax',
		httpOnly: true,
		secure: url.protocol === 'https:'
	});

	if (!code || !returnedState || !stateCookie || stateCookie.state !== returnedState) {
		throw error(400, 'Invalid Cognito authorization response.');
	}

	const redirectUri = `${url.origin}/auth/callback`;
	const tokens = await exchangeCodeForTokens(code, redirectUri, fetch, stateCookie.codeVerifier);
	const expiresAt = Date.now() + tokens.expires_in * 1000 - 60_000; // refresh ahead of expiry
	const user = await fetchUserProfile(tokens.access_token, fetch);

	const session: SessionCookie = {
		expiresAt,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		idToken: tokens.id_token,
		user
	};

	// Store session server-side and only keep session ID in cookie
	const sessionId = createSession(session);
	cookies.set(SESSION_COOKIE, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 7
	});

	throw redirect(302, stateCookie.redirectTo || '/');
};
