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
	console.log('[Auth Callback] Received callback from Cognito');
	console.log('[Auth Callback] url.origin:', url.origin);
	console.log('[Auth Callback] url.href:', url.href);

	const code = url.searchParams.get('code');
	const returnedState = url.searchParams.get('state');
	const stateCookie = decodeState(cookies.get(STATE_COOKIE));

	console.log('[Auth Callback] Code present:', !!code);
	console.log('[Auth Callback] State present:', !!returnedState);
	console.log('[Auth Callback] State cookie present:', !!stateCookie);
	console.log('[Auth Callback] State match:', stateCookie?.state === returnedState);

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
	console.log('[Auth Callback] Using redirect_uri:', redirectUri);

	let tokens;
	try {
		tokens = await exchangeCodeForTokens(code, redirectUri, fetch, stateCookie.codeVerifier);
		console.log('[Auth Callback] Token exchange successful');
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
	console.log('[Auth Callback] Creating session with ID:', sessionId);
	console.log('[Auth Callback] Setting cookie with secure: true, sameSite: none');
	console.log('[Auth Callback] Setting cookie with domain:', url.hostname);

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
	console.log('[Auth Callback] Redirecting to:', redirectPath);
	throw redirect(302, redirectPath);
};
