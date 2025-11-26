// Standardized API response utilities

import { json, type NumericRange } from '@sveltejs/kit';

export interface ApiError {
	status: number;
	error: string;
	details?: string;
	fieldErrors?: Record<string, string>;
	timestamp?: string;
	correlationId?: string;
}

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

export const ApiErrors = {
	badRequest: (message: string, options?: { details?: string; fieldErrors?: Record<string, string>; correlationId?: string }) =>
		errorResponse(400, message, options),

	unauthorized: (message = 'Authentication required', options?: { details?: string; correlationId?: string }) =>
		errorResponse(401, message, options),

	forbidden: (message = 'Access denied', options?: { details?: string; correlationId?: string }) =>
		errorResponse(403, message, options),

	notFound: (message = 'Resource not found', options?: { details?: string; correlationId?: string }) =>
		errorResponse(404, message, options),

	conflict: (message: string, options?: { details?: string; correlationId?: string }) =>
		errorResponse(409, message, options),

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

	internalError: (message = 'An unexpected error occurred', options?: { details?: string; correlationId?: string }) =>
		errorResponse(500, message, options),

	serviceUnavailable: (message = 'Service temporarily unavailable', options?: { details?: string; correlationId?: string }) =>
		errorResponse(503, message, options)
};

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
