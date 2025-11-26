import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { MAPS_TABLE, dynamoDocClient } from '$lib/server/dynamo';
import { batchDeleteItems } from '$lib/server/dynamo-batch';
import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';
import { AuditLog } from '$lib/server/audit-log';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { MAP_INPUT_BUCKET, MAP_OUTPUT_BUCKET, s3Client } from '$lib/server/s3';

type BatchOperation = 'delete' | 'retry' | 'status';

interface BatchRequest {
	operation: BatchOperation;
	maps: Array<{
		mapId: string;
		mapName: string;
	}>;
}

interface BatchResult {
	success: boolean;
	totalRequested: number;
	successful: number;
	failed: number;
	results: Array<{
		mapId: string;
		mapName: string;
		success: boolean;
		error?: string;
	}>;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const correlationId = request.headers.get('X-Correlation-ID') || `server-${Date.now()}`;

	// Authentication check
	if (!locals.user) {
		console.error(`[batch-operations][${correlationId}] User not authenticated`);
		return json({ error: 'Please sign in to perform batch operations' }, { status: 401 });
	}

	// Apply rate limiting
	const rateLimit = checkRateLimit(locals.user.email, RateLimitPresets.API);
	if (!rateLimit.allowed) {
		const resetDate = new Date(rateLimit.resetTime);
		console.warn(
			`[batch-operations][${correlationId}] Rate limit exceeded for user ${locals.user.email}`
		);
		return json(
			{
				error: `Rate limit exceeded. Limit resets at ${resetDate.toLocaleTimeString()}.`,
				rateLimitExceeded: true,
				resetTime: rateLimit.resetTime
			},
			{ status: 429 }
		);
	}

	try {
		const body = (await request.json()) as BatchRequest;
		const { operation, maps } = body;

		// Validate request
		if (!operation || !['delete', 'retry', 'status'].includes(operation)) {
			return json({ error: 'Invalid operation. Must be: delete, retry, or status' }, { status: 400 });
		}

		if (!maps || !Array.isArray(maps) || maps.length === 0) {
			return json({ error: 'No maps provided' }, { status: 400 });
		}

		// Limit batch size to 100 items
		if (maps.length > 100) {
			return json({ error: 'Maximum 100 maps allowed per batch operation' }, { status: 400 });
		}

		console.log(
			`[batch-operations][${correlationId}] Processing ${operation} for ${maps.length} maps (user: ${locals.user.email})`
		);

		// Perform the requested operation
		let result: BatchResult;

		switch (operation) {
			case 'delete':
				result = await batchDeleteMaps(maps, locals.user.email, correlationId);
				break;
			case 'retry':
				result = await batchRetryMaps(maps, locals.user.email, correlationId);
				break;
			case 'status':
				result = await batchGetStatus(maps, locals.user.email, correlationId);
				break;
			default:
				return json({ error: 'Invalid operation' }, { status: 400 });
		}

		// Audit log
		AuditLog.customEvent({
			eventType: `BATCH_${operation.toUpperCase()}` as any,
			userId: locals.user.email,
			action: `batch_${operation}`,
			result: result.success ? 'success' : 'failure',
			metadata: {
				totalRequested: result.totalRequested,
				successful: result.successful,
				failed: result.failed,
				correlationId
			}
		});

		const statusCode = result.success ? 200 : result.failed === result.totalRequested ? 500 : 207; // 207 = Multi-Status
		return json(result, { status: statusCode });
	} catch (error) {
		console.error(`[batch-operations][${correlationId}] Error processing batch operation`, error);
		const errorMessage =
			error instanceof Error
				? `Failed to process batch operation: ${error.message}`
				: 'Failed to process batch operation';
		return json({ error: errorMessage }, { status: 500 });
	}
};

async function batchDeleteMaps(
	maps: Array<{ mapId: string; mapName: string }>,
	userId: string,
	correlationId: string
): Promise<BatchResult> {
	const results: BatchResult['results'] = [];
	let successful = 0;
	let failed = 0;

	// Verify ownership and collect items to delete
	const verifiedMaps: Array<{ mapId: string; mapName: string; jobId?: string }> = [];

	for (const map of maps) {
		try {
			// Check if map exists and user owns it
			const result = await dynamoDocClient.send(
				new QueryCommand({
					TableName: MAPS_TABLE,
					KeyConditionExpression: 'mapId = :mapId AND mapName = :mapName',
					ExpressionAttributeValues: {
						':mapId': map.mapId,
						':mapName': map.mapName
					},
					Limit: 1
				})
			);

			const items = (result as any).Items;
			if (!items || items.length === 0) {
				results.push({
					mapId: map.mapId,
					mapName: map.mapName,
					success: false,
					error: 'Map not found'
				});
				failed++;
				continue;
			}

			const mapItem = items[0];

			// Verify ownership
			if (mapItem.ownerEmail !== userId) {
				results.push({
					mapId: map.mapId,
					mapName: map.mapName,
					success: false,
					error: 'You can only delete your own maps'
				});
				failed++;
				continue;
			}

			verifiedMaps.push({
				mapId: map.mapId,
				mapName: map.mapName,
				jobId: mapItem.jobId
			});
		} catch (error) {
			console.error(
				`[batch-operations][${correlationId}] Error verifying map ${map.mapId}:`,
				error
			);
			results.push({
				mapId: map.mapId,
				mapName: map.mapName,
				success: false,
				error: error instanceof Error ? error.message : 'Verification failed'
			});
			failed++;
		}
	}

	// If no maps were verified, return early
	if (verifiedMaps.length === 0) {
		return {
			success: false,
			totalRequested: maps.length,
			successful: 0,
			failed: maps.length,
			results
		};
	}

	// Batch delete from DynamoDB
	const deleteItems = verifiedMaps.map((map) => ({
		tableName: MAPS_TABLE!,
		key: {
			mapId: map.mapId,
			mapName: map.mapName
		}
	}));

	const batchDeleteResult = await batchDeleteItems(deleteItems);

	// Delete S3 objects in parallel
	const s3DeletePromises = verifiedMaps.map(async (map) => {
		try {
			// Delete input file
			const inputKey = map.mapName;
			// Delete output file (if exists)
			const outputKey = `processed/${map.mapName}`;

			await Promise.all([
				s3Client.send(
					new DeleteObjectsCommand({
						Bucket: MAP_INPUT_BUCKET,
						Delete: {
							Objects: [{ Key: inputKey }]
						}
					})
				),
				s3Client.send(
					new DeleteObjectsCommand({
						Bucket: MAP_OUTPUT_BUCKET,
						Delete: {
							Objects: [{ Key: outputKey }]
						}
					})
				)
			]);

			results.push({
				mapId: map.mapId,
				mapName: map.mapName,
				success: true
			});
			successful++;
		} catch (error) {
			console.error(
				`[batch-operations][${correlationId}] Error deleting S3 objects for ${map.mapId}:`,
				error
			);
			results.push({
				mapId: map.mapId,
				mapName: map.mapName,
				success: false,
				error: 'Failed to delete S3 objects'
			});
			failed++;
		}
	});

	await Promise.allSettled(s3DeletePromises);

	return {
		success: failed === 0,
		totalRequested: maps.length,
		successful,
		failed,
		results
	};
}

async function batchRetryMaps(
	maps: Array<{ mapId: string; mapName: string }>,
	userId: string,
	correlationId: string
): Promise<BatchResult> {
	const results: BatchResult['results'] = [];
	let successful = 0;
	let failed = 0;

	// Process retries in parallel
	const retryPromises = maps.map(async (map) => {
		try {
			// Check if map exists
			const result = await dynamoDocClient.send(
				new QueryCommand({
					TableName: MAPS_TABLE,
					KeyConditionExpression: 'mapId = :mapId AND mapName = :mapName',
					ExpressionAttributeValues: {
						':mapId': map.mapId,
						':mapName': map.mapName
					},
					Limit: 1
				})
			);

			const items = (result as any).Items;
			if (!items || items.length === 0) {
				results.push({
					mapId: map.mapId,
					mapName: map.mapName,
					success: false,
					error: 'Map not found'
				});
				failed++;
				return;
			}

			const mapItem = items[0];

			// Verify ownership
			if (mapItem.ownerEmail !== userId) {
				results.push({
					mapId: map.mapId,
					mapName: map.mapName,
					success: false,
					error: 'You can only retry your own maps'
				});
				failed++;
				return;
			}

			// Check if retry is allowed (only FAILED maps)
			if (mapItem.status !== 'FAILED') {
				results.push({
					mapId: map.mapId,
					mapName: map.mapName,
					success: false,
					error: `Cannot retry map with status: ${mapItem.status}`
				});
				failed++;
				return;
			}

			// Update status to QUEUED
			// Note: In production, this should trigger the ECS task
			await dynamoDocClient.send(
				new UpdateCommand({
					TableName: MAPS_TABLE,
					Key: {
						mapId: map.mapId,
						mapName: map.mapName
					},
					UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
					ExpressionAttributeNames: {
						'#status': 'status'
					},
					ExpressionAttributeValues: {
						':status': 'QUEUED',
						':updatedAt': new Date().toISOString()
					}
				})
			);

			results.push({
				mapId: map.mapId,
				mapName: map.mapName,
				success: true
			});
			successful++;
		} catch (error) {
			console.error(
				`[batch-operations][${correlationId}] Error retrying map ${map.mapId}:`,
				error
			);
			results.push({
				mapId: map.mapId,
				mapName: map.mapName,
				success: false,
				error: error instanceof Error ? error.message : 'Retry failed'
			});
			failed++;
		}
	});

	await Promise.allSettled(retryPromises);

	return {
		success: failed === 0,
		totalRequested: maps.length,
		successful,
		failed,
		results
	};
}

async function batchGetStatus(
	maps: Array<{ mapId: string; mapName: string }>,
	userId: string,
	correlationId: string
): Promise<BatchResult> {
	const results: BatchResult['results'] = [];
	let successful = 0;
	let failed = 0;

	// Query status in parallel
	const statusPromises = maps.map(async (map) => {
		try {
			const result = await dynamoDocClient.send(
				new QueryCommand({
					TableName: MAPS_TABLE,
					KeyConditionExpression: 'mapId = :mapId AND mapName = :mapName',
					ExpressionAttributeValues: {
						':mapId': map.mapId,
						':mapName': map.mapName
					},
					Limit: 1
				})
			);

			const items = (result as any).Items;
			if (!items || items.length === 0) {
				results.push({
					mapId: map.mapId,
					mapName: map.mapName,
					success: false,
					error: 'Map not found'
				});
				failed++;
				return;
			}

			const mapItem = items[0];

			results.push({
				mapId: map.mapId,
				mapName: map.mapName,
				success: true,
				error: undefined,
				...(mapItem as any) // Include all map fields in response
			});
			successful++;
		} catch (error) {
			console.error(
				`[batch-operations][${correlationId}] Error getting status for ${map.mapId}:`,
				error
			);
			results.push({
				mapId: map.mapId,
				mapName: map.mapName,
				success: false,
				error: error instanceof Error ? error.message : 'Status check failed'
			});
			failed++;
		}
	});

	await Promise.allSettled(statusPromises);

	return {
		success: failed === 0,
		totalRequested: maps.length,
		successful,
		failed,
		results
	};
}
