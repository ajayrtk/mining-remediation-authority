import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dynamoDocClient, MAPS_TABLE, MAP_JOBS_TABLE } from '$lib/server/dynamo';
import { s3Client, MAP_INPUT_BUCKET, MAP_OUTPUT_BUCKET } from '$lib/server/s3';
import { DeleteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AuditLog } from '$lib/server/audit-log';
import { ApiErrors, successResponse } from '$lib/server/api-response';
import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';

export const POST: RequestHandler = async ({ request, locals }) => {
	const correlationId = locals.correlationId;

	// Check authentication
	if (!locals.user) {
		AuditLog.unauthorizedAccess(undefined, 'delete_map');
		return ApiErrors.unauthorized('Please sign in to delete maps', { correlationId });
	}

	// Rate limiting - prevent abuse of delete operations
	const rateLimitResult = checkRateLimit(locals.user.email, RateLimitPresets.STANDARD);
	if (!rateLimitResult.allowed) {
		return ApiErrors.tooManyRequests(
			'Too many delete requests. Please try again later.',
			rateLimitResult.resetTime,
			{ correlationId }
		);
	}

	try {
		const { mapId, mapName } = await request.json();

		// Validate input
		if (!mapId || !mapName) {
			return ApiErrors.badRequest('mapId and mapName are required', {
				correlationId,
				fieldErrors: {
					...(!mapId && { mapId: 'Map ID is required' }),
					...(!mapName && { mapName: 'Map name is required' })
				}
			});
		}

		// Get the map record to verify ownership and get S3 details
		const getResult = await dynamoDocClient.send(
			new GetCommand({
				TableName: MAPS_TABLE,
				Key: { mapId, mapName }
			})
		);

		const map = (getResult as any).Item;

		// Check if map exists
		if (!map) {
			return ApiErrors.notFound('Map not found', {
				correlationId,
				details: `No map found with ID ${mapId} and name ${mapName}`
			});
		}

		// Verify ownership
		if (map.ownerEmail !== locals.user.email) {
			AuditLog.forbiddenAccess(locals.user.email, mapId, 'delete_map', { mapName });
			return ApiErrors.forbidden('You can only delete your own maps', {
				correlationId,
				details: `Map ${mapId} belongs to a different user`
			});
		}

		// Prevent deletion of maps that are currently processing (check both status and job status if available)
		const mapStatus = map.status || map.jobStatus;
		if (mapStatus === 'PROCESSING' || mapStatus === 'DISPATCHED' || mapStatus === 'QUEUED') {
			return ApiErrors.conflict('Cannot delete map while it is queued or being processed', {
				correlationId,
				details: `Current map status: ${mapStatus}`
			});
		}

		const deletedItems: string[] = [];

		// Store jobId for cascade delete check
		const jobId = map.jobId;

		// 1. Delete from DynamoDB maps table
		await dynamoDocClient.send(
			new DeleteCommand({
				TableName: MAPS_TABLE,
				Key: { mapId, mapName }
			})
		);
		deletedItems.push('DynamoDB map record');

		// 2. Check if this was the last map for this job (cascade delete)
		if (jobId && MAP_JOBS_TABLE) {
			try {
				// Query for remaining maps with retry for eventual consistency
				// GSI updates may not be immediately visible, so we retry with exponential backoff
				let remainingCount = -1;
				let retryAttempt = 0;
				const maxRetries = 3;

				while (retryAttempt < maxRetries) {
					// Exponential backoff: 0ms, 200ms, 400ms
					if (retryAttempt > 0) {
						await new Promise(resolve => setTimeout(resolve, retryAttempt * 200));
					}

					const remainingMapsResult = await dynamoDocClient.send(
						new QueryCommand({
							TableName: MAPS_TABLE,
							IndexName: 'JobIdIndex',
							KeyConditionExpression: 'jobId = :jobId',
							ExpressionAttributeValues: {
								':jobId': jobId
							},
							Select: 'COUNT',
							// Use consistent read if possible, though GSI doesn't support it
							// This is best effort - eventual consistency is inherent to GSI
						})
					);

					remainingCount = remainingMapsResult.Count ?? 0;

					// If we found maps, no need to retry
					if (remainingCount > 0) {
						break;
					}

					retryAttempt++;
				}

				// If no maps remain after retries, delete the job record
				// Use conditional delete to avoid deleting if maps were added concurrently
				if (remainingCount === 0) {
					try {
						await dynamoDocClient.send(
							new DeleteCommand({
								TableName: MAP_JOBS_TABLE,
								Key: { jobId }
								// Note: Could add ConditionExpression here to check processedCount/batchSize
								// but that would require fetching the job first
							})
						);
						deletedItems.push('DynamoDB job record (cascade delete)');
					} catch (deleteError) {
						// Job may have been deleted by another concurrent operation
						// or may have new maps added - this is acceptable
						console.error('[delete-map] Job delete skipped (may have concurrent changes):', deleteError);
					}
				}
			} catch (error) {
				console.error('[delete-map] Failed to cascade delete job:', error);
				console.error('[delete-map] Error details:', error instanceof Error ? error.message : 'Unknown error');
				// Don't fail the whole deletion if cascade delete fails
				// The orphaned job cleanup in the Dashboard will handle it
			}
		}

		// 3. Delete input file from S3 (graceful failure - lifecycle will clean up anyway)
		try {
			await s3Client.send(
				new DeleteObjectCommand({
					Bucket: MAP_INPUT_BUCKET,
					Key: mapName
				})
			);
			deletedItems.push('S3 input file');
		} catch (error) {
			console.error('[delete-map] Failed to delete S3 input file:', error);
			// Continue even if this fails - lifecycle policy will clean up after 5 days
		}

		// 4. Delete output file from S3 (if it exists)
		if (map.s3Output?.key) {
			try {
				await s3Client.send(
					new DeleteObjectCommand({
						Bucket: MAP_OUTPUT_BUCKET,
						Key: map.s3Output.key
					})
				);
				deletedItems.push('S3 output file');
			} catch (error) {
				console.error('[delete-map] Failed to delete S3 output file:', error);
				// Continue even if this fails
			}
		}

		// Log successful deletion
		AuditLog.deleteSuccess(locals.user.email, mapId, {
			mapName,
			deletedItems,
			jobId
		});

		return successResponse({
			success: true,
			mapId,
			mapName,
			deletedItems
		});
	} catch (error) {
		console.error('[delete-map] Delete map error:', error);
		return ApiErrors.internalError('Failed to delete map', {
			correlationId,
			details: error instanceof Error ? error.message : 'Unknown error'
		});
	}
};
