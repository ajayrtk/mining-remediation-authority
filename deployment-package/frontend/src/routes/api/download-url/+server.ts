/**
 * API endpoint to generate presigned URLs for downloading files from S3
 * URLs are valid for 3 hours
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { json } from '@sveltejs/kit';
import { getS3Client } from '$lib/server/s3';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Please sign in to download files.' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { bucket, key } = body;

		if (!bucket || !key) {
			return json({ error: 'Missing bucket or key parameter.' }, { status: 400 });
		}

		const command = new GetObjectCommand({
			Bucket: bucket,
			Key: key,
			ResponseContentDisposition: `attachment; filename="${key.split('/').pop()}"`
		});

		const url = await getSignedUrl(getS3Client(), command, {
			expiresIn: 10800 // 3 hours
		});

		return json({ url });
	} catch (error) {
		console.error('[download-url] Failed to generate presigned URL:', error);
		return json({ error: 'Failed to generate download URL. Please try again.' }, { status: 500 });
	}
};
