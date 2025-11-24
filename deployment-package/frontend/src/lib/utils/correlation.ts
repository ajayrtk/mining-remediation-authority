/**
 * Request correlation ID utilities for distributed tracing
 *
 * Correlation IDs help track requests across the system:
 * - Frontend → API endpoints → Lambda → ECS
 * - Makes debugging easier by linking related log entries
 * - Helps identify bottlenecks and trace errors
 */

/**
 * Generate a unique correlation ID
 * Format: timestamp-random (e.g., 1732370000000-a1b2c3d4)
 */
export function generateCorrelationId(): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 10);
	return `${timestamp}-${random}`;
}

/**
 * Get or create correlation ID for the current request
 * Stores in sessionStorage to persist across page navigation
 */
export function getOrCreateCorrelationId(): string {
	if (typeof window === 'undefined') {
		// Server-side, generate new ID
		return generateCorrelationId();
	}

	const key = 'mra-correlation-id';
	let correlationId = sessionStorage.getItem(key);

	if (!correlationId) {
		correlationId = generateCorrelationId();
		sessionStorage.setItem(key, correlationId);
	}

	return correlationId;
}

/**
 * Add correlation ID to fetch headers
 */
export function addCorrelationHeader(headers: HeadersInit = {}): HeadersInit {
	const correlationId = getOrCreateCorrelationId();

	return {
		...headers,
		'X-Correlation-ID': correlationId
	};
}

/**
 * Wrapped fetch function that automatically adds correlation ID headers
 * Use this instead of native fetch() for all API calls to enable distributed tracing
 *
 * @example
 * // Instead of:
 * const response = await fetch('/api/maps');
 *
 * // Use:
 * const response = await tracedFetch('/api/maps');
 */
export async function tracedFetch(
	input: RequestInfo | URL,
	init?: RequestInit
): Promise<Response> {
	const correlationId = getOrCreateCorrelationId();

	const headers = new Headers(init?.headers);
	headers.set('X-Correlation-ID', correlationId);

	const response = await fetch(input, {
		...init,
		headers
	});

	// Store the correlation ID from response if server sent one back
	const serverCorrelationId = response.headers.get('X-Correlation-ID');
	if (serverCorrelationId && typeof window !== 'undefined') {
		sessionStorage.setItem('mra-correlation-id', serverCorrelationId);
	}

	return response;
}
