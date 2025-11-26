// Webhook notification system with retry and signature verification

import { env } from '$env/dynamic/private';
import { createHmac } from 'crypto';

const WEBHOOK_SECRET = env.WEBHOOK_SECRET || 'change-me-in-production';
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [1000, 5000, 15000]; // Exponential backoff

export enum WebhookEventType {
	MAP_COMPLETED = 'map.completed',
	MAP_FAILED = 'map.failed',
	BATCH_COMPLETED = 'batch.completed',
	MAP_DELETED = 'map.deleted'
}

export interface WebhookPayload {
	event: WebhookEventType;
	timestamp: string;
	correlationId?: string;
	data: {
		mapId?: string;
		mapName?: string;
		jobId?: string;
		status?: string;
		error?: string;
		outputUrl?: string;
		userId?: string;
		metadata?: Record<string, any>;
	};
}

export interface WebhookDeliveryResult {
	success: boolean;
	statusCode?: number;
	attempts: number;
	error?: string;
	responseBody?: string;
}

export function generateWebhookSignature(payload: string, secret: string = WEBHOOK_SECRET): string {
	const hmac = createHmac('sha256', secret);
	hmac.update(payload);
	return hmac.digest('hex');
}

export function verifyWebhookSignature(
	payload: string,
	signature: string,
	secret: string = WEBHOOK_SECRET
): boolean {
	const expectedSignature = generateWebhookSignature(payload, secret);
	// Use timing-safe comparison to prevent timing attacks
	return timingSafeEqual(signature, expectedSignature);
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

export async function deliverWebhook(
	url: string,
	payload: WebhookPayload,
	options?: {
		maxRetries?: number;
		timeoutMs?: number;
		headers?: Record<string, string>;
	}
): Promise<WebhookDeliveryResult> {
	const maxRetries = options?.maxRetries ?? MAX_RETRY_ATTEMPTS;
	const timeoutMs = options?.timeoutMs ?? 10000; // 10 second timeout
	const customHeaders = options?.headers ?? {};

	const payloadJson = JSON.stringify(payload);
	const signature = generateWebhookSignature(payloadJson);

	let lastError: string | undefined;
	let lastStatusCode: number | undefined;
	let lastResponseBody: string | undefined;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			console.log(
				`[webhook] Delivering ${payload.event} to ${url} (attempt ${attempt + 1}/${maxRetries})`
			);

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Webhook-Signature': signature,
					'X-Webhook-Event': payload.event,
					'X-Webhook-Timestamp': payload.timestamp,
					'X-Correlation-ID': payload.correlationId || '',
					'User-Agent': 'MRA-Mines-Webhook/1.0',
					...customHeaders
				},
				body: payloadJson,
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			lastStatusCode = response.status;
			lastResponseBody = await response.text().catch(() => '');

			// Success: 2xx status codes
			if (response.ok) {
				console.log(
					`[webhook] Successfully delivered ${payload.event} to ${url} (status ${response.status})`
				);
				return {
					success: true,
					statusCode: response.status,
					attempts: attempt + 1,
					responseBody: lastResponseBody
				};
			}

			// Client error (4xx): Don't retry
			if (response.status >= 400 && response.status < 500) {
				lastError = `HTTP ${response.status}: ${lastResponseBody || response.statusText}`;
				console.error(`[webhook] Client error delivering webhook, not retrying: ${lastError}`);
				break; // Don't retry client errors
			}

			// Server error (5xx): Retry with backoff
			lastError = `HTTP ${response.status}: ${lastResponseBody || response.statusText}`;
			console.warn(
				`[webhook] Server error delivering webhook (attempt ${attempt + 1}/${maxRetries}): ${lastError}`
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			lastError = `Network error: ${errorMessage}`;
			console.error(
				`[webhook] Error delivering webhook (attempt ${attempt + 1}/${maxRetries}): ${lastError}`
			);
		}

		// Wait before retry (exponential backoff)
		if (attempt < maxRetries - 1) {
			const backoffMs = RETRY_BACKOFF_MS[attempt] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
			console.log(`[webhook] Waiting ${backoffMs}ms before retry...`);
			await new Promise((resolve) => setTimeout(resolve, backoffMs));
		}
	}

	// All attempts failed
	return {
		success: false,
		statusCode: lastStatusCode,
		attempts: maxRetries,
		error: lastError || 'Unknown error',
		responseBody: lastResponseBody
	};
}

export async function sendMapCompletedWebhook(
	webhookUrl: string,
	data: {
		mapId: string;
		mapName: string;
		outputUrl?: string;
		userId: string;
		correlationId?: string;
		metadata?: Record<string, any>;
	}
): Promise<WebhookDeliveryResult> {
	const payload: WebhookPayload = {
		event: WebhookEventType.MAP_COMPLETED,
		timestamp: new Date().toISOString(),
		correlationId: data.correlationId,
		data: {
			mapId: data.mapId,
			mapName: data.mapName,
			status: 'COMPLETED',
			outputUrl: data.outputUrl,
			userId: data.userId,
			metadata: data.metadata
		}
	};

	return deliverWebhook(webhookUrl, payload);
}

export async function sendMapFailedWebhook(
	webhookUrl: string,
	data: {
		mapId: string;
		mapName: string;
		error: string;
		userId: string;
		correlationId?: string;
		metadata?: Record<string, any>;
	}
): Promise<WebhookDeliveryResult> {
	const payload: WebhookPayload = {
		event: WebhookEventType.MAP_FAILED,
		timestamp: new Date().toISOString(),
		correlationId: data.correlationId,
		data: {
			mapId: data.mapId,
			mapName: data.mapName,
			status: 'FAILED',
			error: data.error,
			userId: data.userId,
			metadata: data.metadata
		}
	};

	return deliverWebhook(webhookUrl, payload);
}

export async function sendBatchCompletedWebhook(
	webhookUrl: string,
	data: {
		jobId: string;
		totalMaps: number;
		successfulMaps: number;
		failedMaps: number;
		userId: string;
		correlationId?: string;
		metadata?: Record<string, any>;
	}
): Promise<WebhookDeliveryResult> {
	const payload: WebhookPayload = {
		event: WebhookEventType.BATCH_COMPLETED,
		timestamp: new Date().toISOString(),
		correlationId: data.correlationId,
		data: {
			jobId: data.jobId,
			userId: data.userId,
			metadata: {
				totalMaps: data.totalMaps,
				successfulMaps: data.successfulMaps,
				failedMaps: data.failedMaps,
				...data.metadata
			}
		}
	};

	return deliverWebhook(webhookUrl, payload);
}

export async function sendMapDeletedWebhook(
	webhookUrl: string,
	data: {
		mapId: string;
		mapName: string;
		userId: string;
		correlationId?: string;
		metadata?: Record<string, any>;
	}
): Promise<WebhookDeliveryResult> {
	const payload: WebhookPayload = {
		event: WebhookEventType.MAP_DELETED,
		timestamp: new Date().toISOString(),
		correlationId: data.correlationId,
		data: {
			mapId: data.mapId,
			mapName: data.mapName,
			userId: data.userId,
			metadata: data.metadata
		}
	};

	return deliverWebhook(webhookUrl, payload);
}

export async function notifyMapStatusChange(
	webhookUrls: string[],
	mapId: string,
	mapName: string,
	status: 'COMPLETED' | 'FAILED',
	options: {
		error?: string;
		outputUrl?: string;
		userId: string;
		correlationId?: string;
		metadata?: Record<string, any>;
	}
): Promise<void> {
	if (!webhookUrls || webhookUrls.length === 0) {
		return; // No webhooks configured
	}

	// Deliver webhooks in parallel
	const deliveryPromises = webhookUrls.map((url) => {
		if (status === 'COMPLETED') {
			return sendMapCompletedWebhook(url, {
				mapId,
				mapName,
				outputUrl: options.outputUrl,
				userId: options.userId,
				correlationId: options.correlationId,
				metadata: options.metadata
			});
		} else {
			return sendMapFailedWebhook(url, {
				mapId,
				mapName,
				error: options.error || 'Unknown error',
				userId: options.userId,
				correlationId: options.correlationId,
				metadata: options.metadata
			});
		}
	});

	// Wait for all webhooks to complete (but don't fail if some fail)
	const results = await Promise.allSettled(deliveryPromises);

	// Log any failures
	results.forEach((result, index) => {
		if (result.status === 'rejected') {
			console.error(`[webhook] Failed to deliver to ${webhookUrls[index]}:`, result.reason);
		} else if (!result.value.success) {
			console.error(
				`[webhook] Failed to deliver to ${webhookUrls[index]}: ${result.value.error}`
			);
		}
	});
}

export interface WebhookConfig {
	webhookId: string;
	userId: string;
	url: string;
	events: WebhookEventType[];
	enabled: boolean;
	headers?: Record<string, string>;
	secret?: string;
	createdAt: string;
	updatedAt: string;
}

