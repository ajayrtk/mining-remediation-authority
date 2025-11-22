import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import JSZip from 'jszip';

// Initialize S3 client
const s3Client = new S3Client({
	region: process.env.AWS_REGION || 'eu-west-1'
});

interface MapDownloadRequest {
	mapId: string;
	mapName: string;
	bucket: string;
	key: string;
}

export const POST: RequestHandler = async ({ request }) => {
	console.log('[bulk-download API] Bulk download request received');

	try {
		const body = await request.json();
		const maps = body.maps as MapDownloadRequest[];

		if (!maps || !Array.isArray(maps) || maps.length === 0) {
			console.log('[bulk-download API] No maps provided');
			return json({ error: 'No maps provided for download' }, { status: 400 });
		}

		console.log(`[bulk-download API] Downloading ${maps.length} maps`);

		// Validate all maps have required fields
		for (const map of maps) {
			if (!map.bucket || !map.key || !map.mapName) {
				console.log('[bulk-download API] Invalid map data:', map);
				return json(
					{ error: `Invalid map data: missing bucket, key, or mapName for map ${map.mapId}` },
					{ status: 400 }
				);
			}
		}

		// Create a new JSZip instance
		const zip = new JSZip();

		// Download all files from S3 and add to ZIP
		for (const map of maps) {
			console.log(`[bulk-download API] Downloading ${map.mapName} from s3://${map.bucket}/${map.key}`);

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
				for await (const chunk of response.Body as any) {
					chunks.push(chunk);
				}
				const buffer = Buffer.concat(chunks);

				// Add file to ZIP with original name
				zip.file(map.mapName, buffer);
				console.log(`[bulk-download API] Added ${map.mapName} to archive (${buffer.length} bytes)`);
			} catch (s3Error) {
				console.error(`[bulk-download API] Failed to download ${map.mapName}:`, s3Error);
				// Continue with other files even if one fails
				continue;
			}
		}

		// Generate ZIP file as buffer
		console.log('[bulk-download API] Generating ZIP file');
		const zipBuffer = await zip.generateAsync({
			type: 'nodebuffer',
			compression: 'DEFLATE',
			compressionOptions: { level: 6 }
		});

		console.log(`[bulk-download API] ZIP file generated (${zipBuffer.length} bytes)`);

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
		return json(
			{
				error: 'Failed to create bulk download',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
