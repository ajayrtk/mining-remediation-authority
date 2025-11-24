/**
 * Webhook management API
 *
 * Endpoints for users to register and manage webhook configurations.
 * Allows users to subscribe to events like map completion notifications.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { QueryCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { WEBHOOKS_TABLE, dynamoDocClient } from '$lib/server/dynamo';
import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';
import { AuditLog } from '$lib/server/audit-log';
import { WebhookEventType, type WebhookConfig } from '$lib/server/webhook';

/**
 * GET - List all webhooks for the current user
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Please sign in to manage webhooks' }, { status: 401 });
	}

	try {
		// Query webhooks by user ID
		const result = await dynamoDocClient.send(
			new QueryCommand({
				TableName: WEBHOOKS_TABLE || 'mra-mines-webhooks',
				IndexName: 'UserIdIndex',
				KeyConditionExpression: 'userId = :userId',
				ExpressionAttributeValues: {
					':userId': locals.user.email
				}
			})
		);

		const webhooks = (result.Items || []) as WebhookConfig[];

		return json({
			webhooks,
			total: webhooks.length
		});
	} catch (error) {
		console.error('[webhooks][GET] Error listing webhooks:', error);
		return json({ error: 'Failed to list webhooks' }, { status: 500 });
	}
};

/**
 * POST - Create a new webhook
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Please sign in to create webhooks' }, { status: 401 });
	}

	// Apply rate limiting
	const rateLimit = checkRateLimit(locals.user.email, RateLimitPresets.API);
	if (!rateLimit.allowed) {
		return json(
			{ error: 'Rate limit exceeded', resetTime: rateLimit.resetTime },
			{ status: 429 }
		);
	}

	try {
		const body = await request.json();
		const { url, events, headers } = body;

		// Validate required fields
		if (!url || typeof url !== 'string') {
			return json({ error: 'Webhook URL is required' }, { status: 400 });
		}

		// Validate URL format
		try {
			const urlObj = new URL(url);
			if (!['http:', 'https:'].includes(urlObj.protocol)) {
				return json({ error: 'Webhook URL must use HTTP or HTTPS' }, { status: 400 });
			}
		} catch {
			return json({ error: 'Invalid webhook URL format' }, { status: 400 });
		}

		// Validate events
		if (!events || !Array.isArray(events) || events.length === 0) {
			return json({ error: 'At least one event type is required' }, { status: 400 });
		}

		const validEvents = Object.values(WebhookEventType);
		const invalidEvents = events.filter((e) => !validEvents.includes(e));
		if (invalidEvents.length > 0) {
			return json(
				{ error: `Invalid event types: ${invalidEvents.join(', ')}` },
				{ status: 400 }
			);
		}

		// Generate webhook ID
		const webhookId = `webhook_${crypto.randomUUID()}`;
		const now = new Date().toISOString();

		const webhook: WebhookConfig = {
			webhookId,
			userId: locals.user.email,
			url,
			events,
			enabled: true,
			headers: headers || {},
			createdAt: now,
			updatedAt: now
		};

		// Save to DynamoDB
		await dynamoDocClient.send(
			new PutCommand({
				TableName: WEBHOOKS_TABLE || 'mra-mines-webhooks',
				Item: webhook
			})
		);

		// Audit log
		AuditLog.customEvent({
			eventType: 'WEBHOOK_CREATED' as any,
			userId: locals.user.email,
			resourceId: webhookId,
			action: 'create_webhook',
			result: 'success',
			metadata: { url, events }
		});

		return json({ webhook }, { status: 201 });
	} catch (error) {
		console.error('[webhooks][POST] Error creating webhook:', error);
		return json({ error: 'Failed to create webhook' }, { status: 500 });
	}
};

/**
 * PATCH - Update an existing webhook
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Please sign in to update webhooks' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { webhookId, url, events, enabled, headers } = body;

		if (!webhookId) {
			return json({ error: 'Webhook ID is required' }, { status: 400 });
		}

		// Build update expression dynamically
		const updates: string[] = [];
		const attributeNames: Record<string, string> = {};
		const attributeValues: Record<string, any> = {
			':updatedAt': new Date().toISOString()
		};

		if (url !== undefined) {
			// Validate URL
			try {
				const urlObj = new URL(url);
				if (!['http:', 'https:'].includes(urlObj.protocol)) {
					return json({ error: 'Webhook URL must use HTTP or HTTPS' }, { status: 400 });
				}
			} catch {
				return json({ error: 'Invalid webhook URL format' }, { status: 400 });
			}

			updates.push('#url = :url');
			attributeNames['#url'] = 'url';
			attributeValues[':url'] = url;
		}

		if (events !== undefined) {
			if (!Array.isArray(events) || events.length === 0) {
				return json({ error: 'At least one event type is required' }, { status: 400 });
			}

			const validEvents = Object.values(WebhookEventType);
			const invalidEvents = events.filter((e) => !validEvents.includes(e));
			if (invalidEvents.length > 0) {
				return json(
					{ error: `Invalid event types: ${invalidEvents.join(', ')}` },
					{ status: 400 }
				);
			}

			updates.push('events = :events');
			attributeValues[':events'] = events;
		}

		if (enabled !== undefined) {
			updates.push('enabled = :enabled');
			attributeValues[':enabled'] = Boolean(enabled);
		}

		if (headers !== undefined) {
			updates.push('headers = :headers');
			attributeValues[':headers'] = headers;
		}

		if (updates.length === 0) {
			return json({ error: 'No fields to update' }, { status: 400 });
		}

		updates.push('updatedAt = :updatedAt');

		// Update webhook
		await dynamoDocClient.send(
			new UpdateCommand({
				TableName: WEBHOOKS_TABLE || 'mra-mines-webhooks',
				Key: { webhookId, userId: locals.user.email },
				UpdateExpression: `SET ${updates.join(', ')}`,
				ExpressionAttributeNames: Object.keys(attributeNames).length > 0 ? attributeNames : undefined,
				ExpressionAttributeValues: attributeValues,
				ConditionExpression: 'userId = :currentUserId',
				ExpressionAttributeValues: {
					...attributeValues,
					':currentUserId': locals.user.email
				}
			})
		);

		// Audit log
		AuditLog.customEvent({
			eventType: 'WEBHOOK_UPDATED' as any,
			userId: locals.user.email,
			resourceId: webhookId,
			action: 'update_webhook',
			result: 'success',
			metadata: { url, events, enabled }
		});

		return json({ success: true });
	} catch (error: any) {
		if (error.name === 'ConditionalCheckFailedException') {
			return json({ error: 'Webhook not found or access denied' }, { status: 404 });
		}

		console.error('[webhooks][PATCH] Error updating webhook:', error);
		return json({ error: 'Failed to update webhook' }, { status: 500 });
	}
};

/**
 * DELETE - Delete a webhook
 */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Please sign in to delete webhooks' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { webhookId } = body;

		if (!webhookId) {
			return json({ error: 'Webhook ID is required' }, { status: 400 });
		}

		// Delete webhook (only if owned by current user)
		await dynamoDocClient.send(
			new DeleteCommand({
				TableName: WEBHOOKS_TABLE || 'mra-mines-webhooks',
				Key: { webhookId, userId: locals.user.email },
				ConditionExpression: 'userId = :userId',
				ExpressionAttributeValues: {
					':userId': locals.user.email
				}
			})
		);

		// Audit log
		AuditLog.customEvent({
			eventType: 'WEBHOOK_DELETED' as any,
			userId: locals.user.email,
			resourceId: webhookId,
			action: 'delete_webhook',
			result: 'success'
		});

		return json({ success: true });
	} catch (error: any) {
		if (error.name === 'ConditionalCheckFailedException') {
			return json({ error: 'Webhook not found or access denied' }, { status: 404 });
		}

		console.error('[webhooks][DELETE] Error deleting webhook:', error);
		return json({ error: 'Failed to delete webhook' }, { status: 500 });
	}
};
