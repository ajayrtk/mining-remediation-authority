// AWS X-Ray tracing utilities

import { env } from '$env/dynamic/private';

// Check if X-Ray is enabled via environment variable
const XRAY_ENABLED = env.XRAY_ENABLED === 'true';

export interface TraceSegment {
	traceId: string;
	segmentId: string;
	parentId?: string;
	name: string;
	startTime: number;
	endTime?: number;
	http?: {
		request?: { url?: string; method?: string; userAgent?: string; clientIp?: string };
		response?: { status?: number; contentLength?: number };
	};
	aws?: {
		operation?: string;
		region?: string;
		requestId?: string;
		retries?: number;
		tableName?: string;
		bucket?: string;
	};
	error?: boolean;
	fault?: boolean;
	cause?: { message?: string; stack?: string; type?: string };
	metadata?: Record<string, any>;
	annotations?: Record<string, string | number | boolean>;
}

// Generate X-Ray format trace ID: 1-{hex timestamp}-{hex random}
export function generateTraceId(): string {
	const timestamp = Math.floor(Date.now() / 1000).toString(16);
	const random = Array.from({ length: 24 }, () =>
		Math.floor(Math.random() * 16).toString(16)
	).join('');
	return `1-${timestamp}-${random}`;
}

export function generateSegmentId(): string {
	return Array.from({ length: 16 }, () =>
		Math.floor(Math.random() * 16).toString(16)
	).join('');
}

// Parse X-Ray header: Root=...;Parent=...;Sampled=1
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

export function createTraceHeader(traceId: string, parentId?: string, sampled = true): string {
	let header = `Root=${traceId}`;
	if (parentId) header += `;Parent=${parentId}`;
	header += `;Sampled=${sampled ? '1' : '0'}`;
	return header;
}

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

export function endSegment(segment: TraceSegment): TraceSegment {
	return {
		...segment,
		endTime: Date.now() / 1000
	};
}

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

export const XRayTracing = {
	isEnabled: () => XRAY_ENABLED,

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
