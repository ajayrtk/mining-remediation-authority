import { buildLogoutUrl } from '$lib/server/cognito';
import { redirect, type RequestHandler } from '@sveltejs/kit';

const SESSION_COOKIE = 'mapml-session';
const STATE_COOKIE = 'mapml-auth-state';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const logoutRedirect = url.searchParams.get('redirectTo') ?? '/';
	const postLogoutUri = `${url.origin}${logoutRedirect}`;
	const logoutUrl = buildLogoutUrl(postLogoutUri);

	const cookieOptions = {
		path: '/',
		sameSite: 'lax' as const,
		httpOnly: true,
		secure: url.protocol === 'https:'
	};

	cookies.delete(SESSION_COOKIE, cookieOptions);
	cookies.delete(STATE_COOKIE, cookieOptions);

	throw redirect(302, logoutUrl);
};
