import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dynamoDocClient, MAPS_TABLE } from '$lib/server/dynamo';
import { s3Client, MAP_INPUT_BUCKET } from '$lib/server/s3';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

export const POST: RequestHandler = async ({ request, locals }) => {
	// Check authentication
	if (!locals.user) {
		return json({ error: 'Please sign in to retry maps' }, { status: 401 });
	}

	try {
		const { mapId, mapName } = await request.json();

		// Validate input
		if (!mapId || !mapName) {
			return json({ error: 'mapId and mapName are required' }, { status: 400 });
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
			return json({ error: 'Map not found' }, { status: 404 });
		}

		// Verify ownership
		if (map.ownerEmail !== locals.user.email) {
			return json({ error: 'You can only retry your own maps' }, { status: 403 });
		}

		// Check if map is in FAILED status
		if (map.status !== 'FAILED') {
			return json({ error: 'Only failed maps can be retried' }, { status: 400 });
		}

		// Check if within 5 days
		const createdDate = new Date(map.createdAt);
		const now = new Date();
		const daysDiff = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

		if (daysDiff > 5) {
			return json({ error: 'Retry period expired (only available for 5 days)' }, { status: 400 });
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
			return json(
				{ error: 'Input file no longer exists in storage. Please upload again.' },
				{ status: 404 }
			);
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
					jobId: map.jobId || `JobId-${crypto.randomUUID()}`,
					batchSize: '1',
					retryAttempt: 'true'
				}
			})
		);

		// Update DynamoDB record to reset status
		await dynamoDocClient.send(
			new UpdateCommand({
				TableName: MAPS_TABLE,
				Key: { mapId, mapName },
				UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #errorMessage = :errorMessage',
				ExpressionAttributeNames: {
					'#status': 'status',
					'#updatedAt': 'updatedAt',
					'#errorMessage': 'errorMessage'
				},
				ExpressionAttributeValues: {
					':status': 'QUEUED',
					':updatedAt': new Date().toISOString(),
					':errorMessage': 'Retry initiated'
				}
			})
		);

		return json({
			success: true,
			mapId,
			mapName,
			message: 'Map retry initiated successfully'
		});
	} catch (error) {
		console.error('[retry-map] Failed to retry map:', error);
		return json(
			{
				error: 'Failed to retry map',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
