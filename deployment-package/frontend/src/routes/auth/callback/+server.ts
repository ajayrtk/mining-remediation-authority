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
		httpOnly: true,
		sameSite: 'lax',
		secure: true
	});

	if (!code || !returnedState || !stateCookie || stateCookie.state !== returnedState) {
		console.error('[Auth Callback] Validation failed');
		throw error(400, 'Invalid Cognito authorization response.');
	}

	const redirectUri = `${url.origin}/auth/callback`;

	let tokens;
	try {
		tokens = await exchangeCodeForTokens(code, redirectUri, fetch, stateCookie.codeVerifier);
	} catch (err) {
		console.error('[Auth Callback] Token exchange failed:', err);
		throw err;
	}
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

	// Delete any existing session cookies first
	cookies.delete(SESSION_COOKIE, {
		path: '/',
		httpOnly: true,
		secure: true
	});

	// Set the new session cookie
	cookies.set(SESSION_COOKIE, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 60 * 60 * 24 * 7
	});

	const redirectPath = stateCookie.redirectTo || '/';
	throw redirect(302, redirectPath);
};
