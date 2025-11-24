import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { s3Client } from '$lib/server/s3';
import { dynamoDocClient, MAPS_TABLE } from '$lib/server/dynamo';
import JSZip from 'jszip';
import type { Readable } from 'stream';
import { ApiErrors } from '$lib/server/api-response';
import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';

interface MapDownloadRequest {
	mapId: string;
	mapName: string;
	bucket: string;
	key: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const correlationId = locals.correlationId;

	// Authentication check
	if (!locals.user) {
		return ApiErrors.unauthorized('Please sign in to download maps', { correlationId });
	}

	// Rate limiting - bulk download is expensive
	const rateLimitResult = checkRateLimit(locals.user.email, RateLimitPresets.STRICT);
	if (!rateLimitResult.allowed) {
		return ApiErrors.tooManyRequests(
			'Too many bulk download requests. Please try again later.',
			rateLimitResult.resetTime,
			{ correlationId }
		);
	}

	try {
		const body = await request.json();
		const maps = body.maps as MapDownloadRequest[];

		if (!maps || !Array.isArray(maps) || maps.length === 0) {
			return ApiErrors.badRequest('No maps provided for download', {
				correlationId,
				fieldErrors: { maps: 'At least one map is required' }
			});
		}

		// Validate all maps have required fields and verify ownership
		for (const map of maps) {
			if (!map.bucket || !map.key || !map.mapName || !map.mapId) {
				return ApiErrors.badRequest('Invalid map data', {
					correlationId,
					details: `Missing bucket, key, mapName, or mapId for map ${map.mapId || 'unknown'}`
				});
			}

			// Verify ownership by querying DynamoDB
			try {
				const result = await dynamoDocClient.send(
					new GetCommand({
						TableName: MAPS_TABLE,
						Key: { mapId: map.mapId, mapName: map.mapName }
					})
				);

				if (!result.Item) {
					return ApiErrors.notFound(`Map not found: ${map.mapName}`, {
						correlationId,
						details: `Map ID: ${map.mapId}`
					});
				}

				if (result.Item.ownerEmail !== locals.user.email) {
					return ApiErrors.forbidden('You can only download your own maps', {
						correlationId,
						details: `Attempted to download map: ${map.mapName}`
					});
				}
			} catch (dbError) {
				console.error('[bulk-download] Ownership verification failed:', dbError);
				return ApiErrors.internalError('Failed to verify map ownership', {
					correlationId,
					details: dbError instanceof Error ? dbError.message : 'Database error'
				});
			}
		}

		// Create a new JSZip instance
		const zip = new JSZip();

		// Download all files from S3 and add to ZIP
		for (const map of maps) {

			try {
				// Download file from S3
				const command = new GetObjectCommand({
					Bucket: map.bucket,
					Key: map.key
				});

				const response = await s3Client.send(command);

				if (!response.Body) {
					console.error(`[bulk-download API] No body in S3 response for ${map.mapName}`);
					continue;
				}

				// Convert S3 body stream to buffer
				const chunks: Uint8Array[] = [];
				for await (const chunk of response.Body as Readable) {
					chunks.push(chunk);
				}
				const buffer = Buffer.concat(chunks);

				// Add file to ZIP with original name
				zip.file(map.mapName, buffer);
			} catch (s3Error) {
				console.error(`[bulk-download API] Failed to download ${map.mapName}:`, s3Error);
				// Continue with other files even if one fails
				continue;
			}
		}

		// Generate ZIP file as buffer
		const zipBuffer = await zip.generateAsync({
			type: 'nodebuffer',
			compression: 'DEFLATE',
			compressionOptions: { level: 6 }
		});


		// Return the ZIP file
		const filename = `maps-${new Date().toISOString().split('T')[0]}.zip`;
		return new Response(zipBuffer, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': zipBuffer.length.toString(),
				'Cache-Control': 'no-cache'
			}
		});
	} catch (error) {
		console.error('[bulk-download API] Error:', error);
		return ApiErrors.internalError('Failed to create bulk download', {
			correlationId,
			details: error instanceof Error ? error.message : 'Unknown error'
		});
	}
};
