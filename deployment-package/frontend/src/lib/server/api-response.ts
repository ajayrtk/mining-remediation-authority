/**
 * Standardized API response utilities
 *
 * Provides consistent error and success response formats across all API endpoints
 * Follows RFC 7807 Problem Details for HTTP APIs for error responses
 */

import { json, type NumericRange } from '@sveltejs/kit';

/**
 * Standard error response format
 */
export interface ApiError {
	/** HTTP status code */
	status: number;
	/** Human-readable error message */
	error: string;
	/** Optional detailed error information (for debugging) */
	details?: string;
	/** Optional field-specific errors */
	fieldErrors?: Record<string, string>;
	/** Timestamp when error occurred */
	timestamp?: string;
	/** Optional correlation ID for request tracing */
	correlationId?: string;
}

/**
 * Create a standardized error response
 *
 * @param status - HTTP status code
 * @param error - Human-readable error message
 * @param options - Optional additional error details
 * @returns JSON response with standardized error format
 */
export function errorResponse(
	status: NumericRange<400, 599>,
	error: string,
	options?: {
		details?: string;
		fieldErrors?: Record<string, string>;
		correlationId?: string;
		headers?: Record<string, string>;
	}
) {
	const errorBody: ApiError = {
		status,
		error,
		timestamp: new Date().toISOString()
	};

	if (options?.details) {
		errorBody.details = options.details;
	}

	if (options?.fieldErrors) {
		errorBody.fieldErrors = options.fieldErrors;
	}

	if (options?.correlationId) {
		errorBody.correlationId = options.correlationId;
	}

	return json(errorBody, {
		status,
		headers: options?.headers
	});
}

/**
 * Shorthand error response creators for common HTTP status codes
 */
export const ApiErrors = {
	/** 400 Bad Request - Invalid request parameters */
	badRequest: (message: string, options?: { details?: string; fieldErrors?: Record<string, string>; correlationId?: string }) =>
		errorResponse(400, message, options),

	/** 401 Unauthorized - Authentication required */
	unauthorized: (message = 'Authentication required', options?: { details?: string; correlationId?: string }) =>
		errorResponse(401, message, options),

	/** 403 Forbidden - Authenticated but not authorized */
	forbidden: (message = 'Access denied', options?: { details?: string; correlationId?: string }) =>
		errorResponse(403, message, options),

	/** 404 Not Found - Resource not found */
	notFound: (message = 'Resource not found', options?: { details?: string; correlationId?: string }) =>
		errorResponse(404, message, options),

	/** 409 Conflict - Request conflicts with current state */
	conflict: (message: string, options?: { details?: string; correlationId?: string }) =>
		errorResponse(409, message, options),

	/** 429 Too Many Requests - Rate limit exceeded */
	tooManyRequests: (
		message: string,
		resetTime: number,
		options?: { details?: string; correlationId?: string; headers?: Record<string, string> }
	) => {
		const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
		return errorResponse(429, message, {
			...options,
			headers: {
				'Retry-After': retryAfter.toString(),
				'X-RateLimit-Reset': resetTime.toString(),
				...(options?.headers || {})
			}
		});
	},

	/** 500 Internal Server Error - Unexpected server error */
	internalError: (message = 'An unexpected error occurred', options?: { details?: string; correlationId?: string }) =>
		errorResponse(500, message, options),

	/** 503 Service Unavailable - Temporary unavailability */
	serviceUnavailable: (message = 'Service temporarily unavailable', options?: { details?: string; correlationId?: string }) =>
		errorResponse(503, message, options)
};

/**
 * Create a standardized success response
 *
 * @param data - Response data
 * @param options - Optional headers and metadata
 * @returns JSON response with data
 */
export function successResponse<T>(
	data: T,
	options?: {
		status?: NumericRange<200, 299>;
		headers?: Record<string, string>;
	}
) {
	return json(data, {
		status: options?.status || 200,
		headers: options?.headers
	});
}
