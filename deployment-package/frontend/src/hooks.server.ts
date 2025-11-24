import type { Handle } from '@sveltejs/kit';
import { type SessionCookie, fetchUserProfile, refreshTokens } from '$lib/server/cognito';
import { getSession, updateSession, deleteSession } from '$lib/server/session-store';
import { XRayTracing, parseTraceHeader, createTraceHeader, generateTraceId, generateSegmentId, addHttpResponse } from '$lib/server/tracing';
import { generateCorrelationId } from '$lib/utils/correlation';

const SESSION_COOKIE = 'mapml-session';


const cookieOptions = () => ({
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: true,
	path: '/',
	maxAge: 60 * 60 * 24 * 7 // one week, refresh will extend
});

export const handle: Handle = async ({ event, resolve }) => {
	// Extract or generate correlation ID for distributed tracing
	const incomingCorrelationId = event.request.headers.get('X-Correlation-ID');
	const correlationId = incomingCorrelationId || generateCorrelationId();

	// Store correlation ID in locals for use in endpoints
	event.locals.correlationId = correlationId;

	// Parse X-Ray trace header if present
	const traceHeader = event.request.headers.get('X-Amzn-Trace-Id');
	const { traceId: incomingTraceId, parentId } = parseTraceHeader(traceHeader);
	const traceId = incomingTraceId || generateTraceId();
	const segmentId = generateSegmentId();

	// Store trace info in locals for use in endpoints
	event.locals.traceId = traceId;
	event.locals.segmentId = segmentId;

	// Start timing for X-Ray
	const startTime = Date.now();

	const sessionId = event.cookies.get(SESSION_COOKIE);
	let session = sessionId ? getSession(sessionId) : null;
	let sessionWasUpdated = false;
	let sessionWasCleared = false;

	let tokenRefreshFailed = false;
	let refreshFailureReason = '';

	if (session && session.expiresAt <= Date.now()) {
		if (session.refreshToken) {
			try {
				const refreshed = await refreshTokens(session.refreshToken, event.fetch);
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
				console.error('[hooks] Failed to refresh Cognito session:', err);
				// Capture failure details for user notification
				tokenRefreshFailed = true;
				refreshFailureReason = err instanceof Error ? err.message : 'Token refresh failed';
				session = null;
				sessionWasCleared = true;
			}
		} else {
			// No refresh token available - session cannot be renewed
			tokenRefreshFailed = true;
			refreshFailureReason = 'No refresh token available';
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
		event.cookies.delete(SESSION_COOKIE, {
			path: '/',
			httpOnly: true,
			secure: true
		});

		// If token refresh failed, add header to notify the client
		// This allows the frontend to show a user-friendly message
		if (tokenRefreshFailed) {
			response.headers.set('X-Session-Expired', 'true');
			response.headers.set('X-Session-Expired-Reason', refreshFailureReason);
		}
	}

	// Add correlation ID to response headers for client-side tracking
	response.headers.set('X-Correlation-ID', correlationId);

	// Add X-Ray trace header to response
	response.headers.set('X-Amzn-Trace-Id', createTraceHeader(traceId, segmentId));

	// Log X-Ray segment if enabled
	if (XRayTracing.isEnabled()) {
		const endTime = Date.now();
		const duration = (endTime - startTime) / 1000;

		console.log('[xray] Request trace:', {
			traceId,
			segmentId,
			correlationId,
			path: event.url.pathname,
			method: event.request.method,
			status: response.status,
			duration: `${duration.toFixed(3)}s`
		});
	}

	return response;
};
