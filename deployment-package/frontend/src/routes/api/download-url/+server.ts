/**
 * API endpoint to generate presigned URLs for downloading files from S3
 * URLs are valid for 15 minutes
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { json } from '@sveltejs/kit';
import { getS3Client } from '$lib/server/s3';
import type { RequestHandler } from './$types';
import { ApiErrors, successResponse } from '$lib/server/api-response';
import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';

export const POST: RequestHandler = async ({ request, locals }) => {
	const correlationId = locals.correlationId;

	if (!locals.user) {
		return ApiErrors.unauthorized('Please sign in to download files.', { correlationId });
	}

	// Rate limiting
	const rateLimitResult = checkRateLimit(locals.user.email, RateLimitPresets.GENEROUS);
	if (!rateLimitResult.allowed) {
		return ApiErrors.tooManyRequests(
			'Too many download requests. Please try again later.',
			rateLimitResult.resetTime,
			{ correlationId }
		);
	}

	try {
		const body = await request.json();
		const { bucket, key } = body;

		if (!bucket || !key) {
			return ApiErrors.badRequest('Missing bucket or key parameter.', {
				correlationId,
				fieldErrors: {
					...(!bucket && { bucket: 'Bucket is required' }),
					...(!key && { key: 'Key is required' })
				}
			});
		}

		const command = new GetObjectCommand({
			Bucket: bucket,
			Key: key,
			ResponseContentDisposition: `attachment; filename="${key.split('/').pop()}"`
		});

		const url = await getSignedUrl(getS3Client(), command, {
			expiresIn: 900 // 15 minutes
		});

		return successResponse({ url });
	} catch (error) {
		console.error('[download-url] Failed to generate presigned URL:', error);
		return ApiErrors.internalError('Failed to generate download URL', {
			correlationId,
			details: error instanceof Error ? error.message : 'Unknown error'
		});
	}
};
