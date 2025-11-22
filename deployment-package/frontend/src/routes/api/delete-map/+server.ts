import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dynamoDocClient, MAPS_TABLE, MAP_JOBS_TABLE } from '$lib/server/dynamo';
import { s3Client, MAP_INPUT_BUCKET, MAP_OUTPUT_BUCKET } from '$lib/server/s3';
import { DeleteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

export const POST: RequestHandler = async ({ request, locals }) => {
	// Check authentication
	if (!locals.user) {
		return json({ error: 'Please sign in to delete maps' }, { status: 401 });
	}

	try {
		const { mapId, mapName } = await request.json();

		// Validate input
		if (!mapId || !mapName) {
			return json({ error: 'mapId and mapName are required' }, { status: 400 });
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
			return json({ error: 'Map not found' }, { status: 404 });
		}

		// Verify ownership
		if (map.ownerEmail !== locals.user.email) {
			return json({ error: 'You can only delete your own maps' }, { status: 403 });
		}

		// Prevent deletion of maps that are currently processing (check both status and job status if available)
		const mapStatus = map.status || map.jobStatus;
		if (mapStatus === 'PROCESSING' || mapStatus === 'DISPATCHED' || mapStatus === 'QUEUED') {
			return json(
				{ error: 'Cannot delete map while it is queued or being processed' },
				{ status: 409 }
			);
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
				console.log(`[delete-map] Checking cascade delete for job ${jobId} after deleting ${mapName}`);

				// Add a small delay to allow GSI to catch up (eventual consistency)
				// This reduces (but doesn't eliminate) race conditions with GSI updates
				await new Promise(resolve => setTimeout(resolve, 100));

				// Query for remaining maps with this jobId
				const remainingMapsResult = await dynamoDocClient.send(
					new QueryCommand({
						TableName: MAPS_TABLE,
						IndexName: 'JobIdIndex',
						KeyConditionExpression: 'jobId = :jobId',
						ExpressionAttributeValues: {
							':jobId': jobId
						},
						Select: 'COUNT'
					})
				);

				const remainingCount = remainingMapsResult.Count ?? 0;
				console.log(`[delete-map] Job ${jobId} has ${remainingCount} remaining maps`);

				// If no maps remain for this job, delete the job record
				if (remainingCount === 0) {
					console.log(`[delete-map] Attempting to delete job ${jobId} (cascade delete)`);
					await dynamoDocClient.send(
						new DeleteCommand({
							TableName: MAP_JOBS_TABLE,
							Key: { jobId }
						})
					);
					deletedItems.push('DynamoDB job record (cascade delete)');
					console.log(`[delete-map] Successfully cascade deleted job ${jobId} - no maps remaining`);
				} else {
					console.log(`[delete-map] Skipping cascade delete for job ${jobId} - still has ${remainingCount} maps`);
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
			console.error('Failed to delete S3 input file:', error);
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
				console.error('Failed to delete S3 output file:', error);
				// Continue even if this fails
			}
		}

		return json({
			success: true,
			mapId,
			mapName,
			deletedItems
		});
	} catch (error) {
		console.error('Delete map error:', error);
		return json(
			{
				error: 'Failed to delete map',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
