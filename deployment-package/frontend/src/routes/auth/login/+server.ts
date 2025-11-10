import { redirect, type RequestHandler } from '@sveltejs/kit';
import { buildLoginUrl } from '$lib/server/cognito';
import { createHash, randomBytes } from 'node:crypto';

const STATE_COOKIE = 'mapml-auth-state';

export const GET: RequestHandler = async ({ url, cookies }) => {
	console.log('[Auth Login] Starting login flow');
	console.log('[Auth Login] url.origin:', url.origin);

	const state = randomBytes(16).toString('hex');
	const codeVerifier = randomBytes(32).toString('base64url');
	const codeChallenge = createHash('sha256')
		.update(codeVerifier)
		.digest('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
	const redirectUri = `${url.origin}/auth/callback`;
	console.log('[Auth Login] Using redirect_uri:', redirectUri);

	const redirectTo = url.searchParams.get('redirectTo') ?? '/';
	const loginUrl = buildLoginUrl(redirectUri, state, { codeChallenge });
	console.log('[Auth Login] Redirecting to Cognito');

	const payload = Buffer.from(
		JSON.stringify({ state, redirectTo, codeVerifier }),
		'utf8'
	).toString('base64url');

	cookies.set(STATE_COOKIE, payload, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 300
	});

	throw redirect(302, loginUrl);
};
