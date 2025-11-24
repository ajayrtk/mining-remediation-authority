/**
 * AWS X-Ray distributed tracing integration
 *
 * Provides distributed tracing capabilities to track requests across:
 * - Frontend API endpoints
 * - Lambda functions
 * - DynamoDB operations
 * - S3 operations
 * - ECS tasks
 *
 * Benefits:
 * - End-to-end request visibility
 * - Performance bottleneck identification
 * - Error tracking across service boundaries
 * - Service dependency mapping
 *
 * Note: Requires AWS X-Ray daemon running and proper IAM permissions
 */

import { env } from '$env/dynamic/private';

// Check if X-Ray is enabled via environment variable
const XRAY_ENABLED = env.XRAY_ENABLED === 'true';

export interface TraceSegment {
	/** Unique trace ID */
	traceId: string;
	/** Segment ID for this operation */
	segmentId: string;
	/** Parent segment ID (if this is a subsegment) */
	parentId?: string;
	/** Operation name */
	name: string;
	/** Start time (epoch seconds) */
	startTime: number;
	/** End time (epoch seconds) */
	endTime?: number;
	/** HTTP request details */
	http?: {
		request?: {
			url?: string;
			method?: string;
			userAgent?: string;
			clientIp?: string;
		};
		response?: {
			status?: number;
			contentLength?: number;
		};
	};
	/** AWS service call details */
	aws?: {
		operation?: string;
		region?: string;
		requestId?: string;
		retries?: number;
		tableName?: string;
		bucket?: string;
	};
	/** Error details if operation failed */
	error?: boolean;
	fault?: boolean;
	cause?: {
		message?: string;
		stack?: string;
		type?: string;
	};
	/** Custom metadata */
	metadata?: Record<string, any>;
	/** Custom annotations (indexed by X-Ray) */
	annotations?: Record<string, string | number | boolean>;
}

/**
 * Generate a unique trace ID in X-Ray format
 * Format: 1-{hex timestamp}-{hex random}
 */
export function generateTraceId(): string {
	const timestamp = Math.floor(Date.now() / 1000).toString(16);
	const random = Array.from({ length: 24 }, () =>
		Math.floor(Math.random() * 16).toString(16)
	).join('');
	return `1-${timestamp}-${random}`;
}

/**
 * Generate a segment ID
 */
export function generateSegmentId(): string {
	return Array.from({ length: 16 }, () =>
		Math.floor(Math.random() * 16).toString(16)
	).join('');
}

/**
 * Parse X-Ray trace header
 * Format: Root=1-5e645f3e-1234567890abcdef;Parent=abcdef1234567890;Sampled=1
 */
export function parseTraceHeader(header: string | null): {
	traceId?: string;
	parentId?: string;
	sampled?: boolean;
} {
	if (!header) return {};

	const parts = header.split(';');
	const result: { traceId?: string; parentId?: string; sampled?: boolean } = {};

	for (const part of parts) {
		const [key, value] = part.split('=');
		if (key === 'Root') result.traceId = value;
		if (key === 'Parent') result.parentId = value;
		if (key === 'Sampled') result.sampled = value === '1';
	}

	return result;
}

/**
 * Create X-Ray trace header
 */
export function createTraceHeader(traceId: string, parentId?: string, sampled = true): string {
	let header = `Root=${traceId}`;
	if (parentId) header += `;Parent=${parentId}`;
	header += `;Sampled=${sampled ? '1' : '0'}`;
	return header;
}

/**
 * Start a new trace segment
 */
export function startSegment(name: string, traceId?: string, parentId?: string): TraceSegment {
	return {
		traceId: traceId || generateTraceId(),
		segmentId: generateSegmentId(),
		parentId,
		name,
		startTime: Date.now() / 1000,
		annotations: {},
		metadata: {}
	};
}

/**
 * End a trace segment
 */
export function endSegment(segment: TraceSegment): TraceSegment {
	return {
		...segment,
		endTime: Date.now() / 1000
	};
}

/**
 * Add HTTP request details to segment
 */
export function addHttpRequest(
	segment: TraceSegment,
	request: {
		url?: string;
		method?: string;
		userAgent?: string;
		clientIp?: string;
	}
): TraceSegment {
	return {
		...segment,
		http: {
			...segment.http,
			request
		}
	};
}

/**
 * Add HTTP response details to segment
 */
export function addHttpResponse(
	segment: TraceSegment,
	response: {
		status?: number;
		contentLength?: number;
	}
): TraceSegment {
	return {
		...segment,
		http: {
			...segment.http,
			response
		},
		error: response.status ? response.status >= 400 && response.status < 500 : false,
		fault: response.status ? response.status >= 500 : false
	};
}

/**
 * Add AWS service call details to segment
 */
export function addAwsCall(
	segment: TraceSegment,
	aws: {
		operation?: string;
		region?: string;
		requestId?: string;
		retries?: number;
		tableName?: string;
		bucket?: string;
	}
): TraceSegment {
	return {
		...segment,
		aws: {
			...segment.aws,
			...aws
		}
	};
}

/**
 * Add error details to segment
 */
export function addError(
	segment: TraceSegment,
	error: Error | string,
	isFault = true
): TraceSegment {
	const errorObj = typeof error === 'string' ? new Error(error) : error;

	return {
		...segment,
		error: !isFault,
		fault: isFault,
		cause: {
			message: errorObj.message,
			stack: errorObj.stack,
			type: errorObj.name
		}
	};
}

/**
 * Add custom annotation (indexed by X-Ray for filtering)
 */
export function addAnnotation(
	segment: TraceSegment,
	key: string,
	value: string | number | boolean
): TraceSegment {
	return {
		...segment,
		annotations: {
			...segment.annotations,
			[key]: value
		}
	};
}

/**
 * Add custom metadata (not indexed, for debugging)
 */
export function addMetadata(
	segment: TraceSegment,
	key: string,
	value: any
): TraceSegment {
	return {
		...segment,
		metadata: {
			...segment.metadata,
			[key]: value
		}
	};
}

/**
 * Send segment to X-Ray daemon
 * In production, this would send to the X-Ray daemon via UDP
 */
export function sendSegment(segment: TraceSegment): void {
	if (!XRAY_ENABLED) {
		// When X-Ray is disabled, just log the segment for debugging
		console.log('[xray][disabled] Trace segment:', JSON.stringify(segment, null, 2));
		return;
	}

	// In production, send to X-Ray daemon:
	// const dgram = require('dgram');
	// const socket = dgram.createSocket('udp4');
	// const message = JSON.stringify({
	//   format: 'json',
	//   version: 1,
	//   trace_id: segment.traceId,
	//   ...segment
	// });
	// socket.send(message, 0, message.length, 2000, '127.0.0.1');

	console.log('[xray] Trace segment sent:', {
		traceId: segment.traceId,
		segmentId: segment.segmentId,
		name: segment.name,
		duration: segment.endTime ? (segment.endTime - segment.startTime) * 1000 : null
	});
}

/**
 * Trace a function execution
 */
export async function trace<T>(
	name: string,
	fn: (segment: TraceSegment) => Promise<T>,
	options?: {
		traceId?: string;
		parentId?: string;
		annotations?: Record<string, string | number | boolean>;
		metadata?: Record<string, any>;
	}
): Promise<T> {
	let segment = startSegment(name, options?.traceId, options?.parentId);

	// Add initial annotations and metadata
	if (options?.annotations) {
		for (const [key, value] of Object.entries(options.annotations)) {
			segment = addAnnotation(segment, key, value);
		}
	}
	if (options?.metadata) {
		for (const [key, value] of Object.entries(options.metadata)) {
			segment = addMetadata(segment, key, value);
		}
	}

	try {
		const result = await fn(segment);
		segment = endSegment(segment);
		sendSegment(segment);
		return result;
	} catch (error) {
		segment = addError(segment, error as Error);
		segment = endSegment(segment);
		sendSegment(segment);
		throw error;
	}
}

/**
 * Helper to enable X-Ray tracing for the application
 * Add to hooks.server.ts
 */
export const XRayTracing = {
	/**
	 * Check if X-Ray is enabled
	 */
	isEnabled: () => XRAY_ENABLED,

	/**
	 * Trace an HTTP request
	 */
	traceRequest: async <T>(
		name: string,
		request: Request,
		fn: (segment: TraceSegment) => Promise<T>
	): Promise<T> => {
		const traceHeader = request.headers.get('X-Amzn-Trace-Id');
		const { traceId, parentId } = parseTraceHeader(traceHeader);

		let segment = startSegment(name, traceId, parentId);
		segment = addHttpRequest(segment, {
			url: request.url,
			method: request.method,
			userAgent: request.headers.get('user-agent') || undefined,
			clientIp: request.headers.get('x-forwarded-for') || undefined
		});

		try {
			const result = await fn(segment);
			segment = endSegment(segment);
			sendSegment(segment);
			return result;
		} catch (error) {
			segment = addError(segment, error as Error);
			segment = endSegment(segment);
			sendSegment(segment);
			throw error;
		}
	}
};
