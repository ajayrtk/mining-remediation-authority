import { env as svelteEnv } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';

// Hybrid approach: use $env/dynamic/private in dev, process.env in production
// Check if SvelteKit env has values, otherwise fall back to process.env
const hasEnvValues = Object.keys(svelteEnv).some(k => k.startsWith('COGNITO_'));
const env = hasEnvValues ? svelteEnv : process.env;

type CognitoConfig = {
	region: string;
	clientId: string;
	domain: string;
	userPoolId: string;
	scopes: string[];
};

export type CognitoUser = {
	sub: string;
	email?: string;
	name?: string;
	username?: string;
};

type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	id_token: string;
	expires_in: number;
	token_type: string;
};

let cachedConfig: CognitoConfig | null = null;

const ensureConfig = (): CognitoConfig => {
	if (cachedConfig) {
		return cachedConfig;
	}

	const region = env.COGNITO_REGION;
	const clientId = env.COGNITO_CLIENT_ID;
	const domain = env.COGNITO_DOMAIN;
	const userPoolId = env.COGNITO_USER_POOL_ID;

	if (!region || !clientId || !domain || !userPoolId) {
		error(500, 'Missing Cognito configuration.');
	}

	cachedConfig = {
		region,
		clientId,
		domain,
		userPoolId,
		scopes: ['openid', 'email', 'profile']
	};

	return cachedConfig;
};

const getIssuer = () => `https://${ensureConfig().domain}`;

export const buildLoginUrl = (
	redirectUri: string,
	state: string,
	options?: { loginHint?: string; codeChallenge?: string }
) => {
	const config = ensureConfig();
	const params = new URLSearchParams({
		client_id: config.clientId,
		response_type: 'code',
		scope: config.scopes.join(' '),
		redirect_uri: redirectUri,
		state
	});

	if (options?.loginHint) {
		params.set('login_hint', options.loginHint);
	}

	if (options?.codeChallenge) {
		params.set('code_challenge', options.codeChallenge);
		params.set('code_challenge_method', 'S256');
	}

	return `${getIssuer()}/oauth2/authorize?${params.toString()}`;
};

export const buildLogoutUrl = (logoutRedirectUri: string) => {
	const config = ensureConfig();
	const params = new URLSearchParams({
		client_id: config.clientId,
		logout_uri: logoutRedirectUri
	});

	return `${getIssuer()}/logout?${params.toString()}`;
};

export const exchangeCodeForTokens = async (
	code: string,
	redirectUri: string,
	fetchFn: typeof fetch,
	codeVerifier?: string
) => {
	const config = ensureConfig();
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: config.clientId,
		code,
		redirect_uri: redirectUri
	});

	if (codeVerifier) {
		body.set('code_verifier', codeVerifier);
	}

	const response = await fetchFn(`${getIssuer()}/oauth2/token`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: body.toString()
	});

	if (!response.ok) {
		const message = await response.text();
		error(response.status, `Failed to exchange auth code: ${message}`);
	}

	const tokens = (await response.json()) as TokenResponse;
	return tokens;
};

export const refreshTokens = async (
	refreshToken: string,
	fetchFn: typeof fetch
): Promise<TokenResponse> => {
	const config = ensureConfig();
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: config.clientId,
		refresh_token: refreshToken
	});

	const response = await fetchFn(`${getIssuer()}/oauth2/token`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: body.toString()
	});

	if (!response.ok) {
		const message = await response.text();
		error(response.status, `Failed to refresh tokens: ${message}`);
	}

	return (await response.json()) as TokenResponse;
};

export const fetchUserProfile = async (accessToken: string, fetchFn: typeof fetch): Promise<CognitoUser> => {
	const response = await fetchFn(`${getIssuer()}/oauth2/userInfo`, {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const message = await response.text();
		error(response.status, `Failed to fetch Cognito user profile: ${message}`);
	}

	const user = (await response.json()) as Record<string, string>;

	// Cognito userInfo returns 'cognito:username' for the username
	const username = user['cognito:username'] || user.username;

	return {
		sub: user.sub,
		email: user.email,
		username: username,
		name: user.name ?? user.email ?? username ?? user.sub
	};
};

export type SessionCookie = {
	expiresAt: number;
	accessToken: string;
	refreshToken?: string;
	idToken: string;
	user: CognitoUser;
};
