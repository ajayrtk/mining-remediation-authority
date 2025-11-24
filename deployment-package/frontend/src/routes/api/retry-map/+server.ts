import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dynamoDocClient, MAPS_TABLE } from '$lib/server/dynamo';
import { s3Client, MAP_INPUT_BUCKET } from '$lib/server/s3';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ApiErrors, successResponse } from '$lib/server/api-response';
import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';

export const POST: RequestHandler = async ({ request, locals }) => {
	const correlationId = locals.correlationId;

	// Check authentication
	if (!locals.user) {
		return ApiErrors.unauthorized('Please sign in to retry maps', { correlationId });
	}

	// Rate limiting
	const rateLimitResult = checkRateLimit(locals.user.email, RateLimitPresets.STANDARD);
	if (!rateLimitResult.allowed) {
		return ApiErrors.tooManyRequests(
			'Too many retry requests. Please try again later.',
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

		// Get the map record to verify ownership and status
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
			return ApiErrors.forbidden('You can only retry your own maps', {
				correlationId,
				details: `Map ${mapId} belongs to a different user`
			});
		}

		// Check if map is in FAILED status
		if (map.status !== 'FAILED') {
			return ApiErrors.badRequest('Only failed maps can be retried', {
				correlationId,
				details: `Current map status: ${map.status}`
			});
		}

		// Check if within 5 days
		const createdDate = new Date(map.createdAt);
		const now = new Date();
		const daysDiff = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

		if (daysDiff > 5) {
			return ApiErrors.badRequest('Retry period expired (only available for 5 days)', {
				correlationId,
				details: `Map created ${daysDiff.toFixed(1)} days ago`
			});
		}

		// Validate jobId exists (required for retry to maintain job tracking)
		if (!map.jobId) {
			return ApiErrors.badRequest('Map has no associated job ID. Cannot retry.', {
				correlationId
			});
		}

		// Check if input file still exists in S3
		try {
			await s3Client.send(
				new HeadObjectCommand({
					Bucket: MAP_INPUT_BUCKET,
					Key: mapName
				})
			);
		} catch (error) {
			return ApiErrors.notFound('Input file no longer exists in storage. Please upload again.', {
				correlationId,
				details: 'S3 file not found or expired'
			});
		}

		// Copy the file to itself to trigger the S3 event and Lambda processing
		// This will re-invoke the processing pipeline
		await s3Client.send(
			new CopyObjectCommand({
				Bucket: MAP_INPUT_BUCKET,
				CopySource: `${MAP_INPUT_BUCKET}/${mapName}`,
				Key: mapName,
				MetadataDirective: 'REPLACE',
				Metadata: {
					originalFilename: mapName,
					submittedBy: locals.user.email,
					mapId: mapId,
					jobId: map.jobId,
					batchSize: '1',
					retryAttempt: 'true'
				}
			})
		);

		// Update DynamoDB record to reset status and track retry count
		// Increment retryCount to track how many times user has retried this map
		await dynamoDocClient.send(
			new UpdateCommand({
				TableName: MAPS_TABLE,
				Key: { mapId, mapName },
				UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #errorMessage = :errorMessage, #retryCount = if_not_exists(#retryCount, :zero) + :inc',
				ExpressionAttributeNames: {
					'#status': 'status',
					'#updatedAt': 'updatedAt',
					'#errorMessage': 'errorMessage',
					'#retryCount': 'retryCount'
				},
				ExpressionAttributeValues: {
					':status': 'QUEUED',
					':updatedAt': new Date().toISOString(),
					':errorMessage': 'Manual retry initiated',
					':zero': 0,
					':inc': 1
				}
			})
		);

		return successResponse({
			success: true,
			mapId,
			mapName,
			message: 'Map retry initiated successfully'
		});
	} catch (error) {
		console.error('[retry-map] Failed to retry map:', error);
		return ApiErrors.internalError('Failed to retry map', {
			correlationId,
			details: error instanceof Error ? error.message : 'Unknown error'
		});
	}
};
