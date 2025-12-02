// Presigned URL API - generates signed URLs for direct S3 uploads
// Checks for duplicates and handles retry logic for failed uploads

import { parseMapFilename, sanitizeMapFilename } from '$lib/utils/filenameParser';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { json } from '@sveltejs/kit';
import { MAPS_TABLE, dynamoDocClient } from '$lib/server/dynamo';
import { MAP_INPUT_BUCKET, getS3Client } from '$lib/server/s3';
import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

// Constants for retry logic timeouts
const PROCESSING_TIMEOUT_MINUTES = 30;
const QUEUED_TIMEOUT_MINUTES = 10;
// Reduced from 1 hour to 15 minutes for better security
// URLs are only needed for immediate upload after generation
const PRESIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes

const ALLOWED_MIME = new Set([
	'application/zip',
	'application/x-zip-compressed',
	'multipart/x-zip',
	'application/octet-stream'
]);


// Check if this file was already uploaded and whether we should allow retry
// This implements the retry logic - COMPLETED files can't be retried,
// but FAILED files can be re-uploaded to try processing again.
const checkMapExists = async (mapId: string): Promise<{
	exists: boolean;
	existingName?: string;
	canRetry: boolean;
	status?: string;
	reason?: string;
}> => {
	if (!MAPS_TABLE) {
		return { exists: false, canRetry: true };
	}

	try {
		// Query DynamoDB to see if this map already exists
		const result = await dynamoDocClient.send(
			new QueryCommand({
				TableName: MAPS_TABLE,
				KeyConditionExpression: 'mapId = :mapId',
				ExpressionAttributeValues: { ':mapId': mapId },
				Limit: 1
			})
		);

		const items = (result as any).Items;
		if (items && items.length > 0) {
			const map = items[0];
			const existingName = String(map.mapName ?? '');
			const status = String(map.status ?? '');
			const hasOutput = !!(map.s3Output && map.processedAt);

			// Figure out how long ago this was created
			// We use this to detect stuck processing jobs
			const now = Date.now();
			const createdAt = map.createdAt ? new Date(map.createdAt).getTime() : now;
			const ageMinutes = (now - createdAt) / 1000 / 60;

			// Now decide: can this file be retried or not?
			let canRetry = false;
			let reason = '';

			if (status === 'COMPLETED' || (hasOutput && !status)) {
				// File processed successfully - don't allow retry
				// This prevents duplicate processing of already successful files
				canRetry = false;
				reason = 'This map was already processed successfully';
			} else if (status === 'FAILED') {
				// File failed last time - allow retry
				// This is the main retry use case
				canRetry = true;
				reason = 'Previous processing failed, retry allowed';
			} else if (status === 'PROCESSING' || status === 'DISPATCHED') {
				// File is currently processing - check if it's stuck
				// If it's been processing for over PROCESSING_TIMEOUT_MINUTES, something's wrong
				if (ageMinutes > PROCESSING_TIMEOUT_MINUTES) {
					canRetry = true;
					reason = `Processing timeout detected (>${PROCESSING_TIMEOUT_MINUTES} min), retry allowed`;
				} else {
					canRetry = false;
					reason = 'File is currently being processed, please wait';
				}
			} else if (!status || status === 'QUEUED') {
				// File is queued but hasn't started - check if it's stale
				// If queued for over QUEUED_TIMEOUT_MINUTES, probably stuck
				if (ageMinutes > QUEUED_TIMEOUT_MINUTES) {
					canRetry = true;
					reason = `Stale pending job detected (>${QUEUED_TIMEOUT_MINUTES} min), retry allowed`;
				} else {
					canRetry = false;
					reason = 'File is queued for processing';
				}
			} else if (!hasOutput) {
				// Edge case: has a status but no output
				// Probably failed without proper error tracking
				canRetry = true;
				reason = 'Incomplete processing detected, retry allowed';
			}

			return {
				exists: true,
				existingName,
				canRetry,
				status: status || 'UNKNOWN',
				reason
			};
		}

		// Map doesn't exist, so this is a new file
		return { exists: false, canRetry: true };
	} catch (error) {
		console.error(`[presigned-url] Failed to check if map ${mapId} exists`, error);
		// If we can't check, err on the side of allowing upload
		return { exists: false, canRetry: true };
	}
};

// Reserve mapId atomically before generating presigned URL
// Uses conditional write to prevent race conditions in multi-user scenarios
// Only the first request wins - subsequent requests get rejected
const reserveMapId = async (
	mapId: string,
	mapName: string,
	submittedBy: string,
	jobId: string
): Promise<{
	reserved: boolean;
	existingName?: string;
	reason?: string;
}> => {
	if (!MAPS_TABLE) {
		return { reserved: true }; // Skip if no table configured
	}

	try {
		await dynamoDocClient.send(
			new PutCommand({
				TableName: MAPS_TABLE,
				Item: {
					mapId: mapId,
					mapName: mapName,
					status: 'RESERVED',
					submittedBy: submittedBy,
					jobId: jobId,
					createdAt: new Date().toISOString(),
					reservedAt: new Date().toISOString()
				},
				// Only succeed if mapId doesn't exist OR status is FAILED (retry allowed)
				ConditionExpression: 'attribute_not_exists(mapId) OR #status = :failed',
				ExpressionAttributeNames: { '#status': 'status' },
				ExpressionAttributeValues: { ':failed': 'FAILED' }
			})
		);
		return { reserved: true };
	} catch (error: any) {
		if (error.name === 'ConditionalCheckFailedException') {
			// Another request already reserved this mapId
			// Fetch existing record to get details
			const existing = await checkMapExists(mapId);
			return {
				reserved: false,
				existingName: existing.existingName,
				reason: existing.reason || 'Already being processed by another user'
			};
		}
		throw error;
	}
};

type FileRequest = {
	name: string;
	size: number;
	type: string;
	hash: string;
};

type PresignedUrlResponse = {
	url: string;
	key: string;
	mapId: string;
	metadata: {
		originalFilename: string;
		submittedBy: string;
		mapId: string;
		jobId: string;
		batchSize: string;
	};
};

// Main POST handler - generates presigned URLs for file uploads
export const POST: RequestHandler = async ({ request, locals }) => {
	// Extract correlation ID from request headers for distributed tracing
	const correlationId = request.headers.get('X-Correlation-ID') || `server-${Date.now()}`;

	// Make sure user is authenticated before allowing uploads
	if (!locals.user) {
		console.error(`[presigned-url][${correlationId}] User not authenticated`);
		return json({ error: 'Please sign in to upload files.' }, { status: 401 });
	}

	// Apply rate limiting to prevent abuse
	// Upload endpoint uses strict limit: 20 uploads per hour
	const rateLimit = checkRateLimit(locals.user.email, RateLimitPresets.UPLOAD);
	if (!rateLimit.allowed) {
		const resetDate = new Date(rateLimit.resetTime);
		console.warn(`[presigned-url][${correlationId}] Rate limit exceeded for user ${locals.user.email}`);
		return json(
			{
				error: `Rate limit exceeded. You can upload ${rateLimit.limit} batches per hour. Limit resets at ${resetDate.toLocaleTimeString()}.`,
				rateLimitExceeded: true,
				resetTime: rateLimit.resetTime
			},
			{
				status: 429,
				headers: {
					'X-RateLimit-Limit': rateLimit.limit.toString(),
					'X-RateLimit-Remaining': '0',
					'X-RateLimit-Reset': rateLimit.resetTime.toString(),
					'Retry-After': Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString()
				}
			}
		);
	}

	try {
		const body = await request.json();
		const files = body.files as FileRequest[];

		console.log(`[presigned-url][${correlationId}] Processing ${files?.length || 0} file(s) for user ${locals.user.email} (${rateLimit.remaining} uploads remaining)`);

		// Validate request
		if (!files || !Array.isArray(files) || files.length === 0) {
			return json({ error: 'No files provided.' }, { status: 400 });
		}

		// Limit batch size to 20 files
		if (files.length > 20) {
			return json({ error: 'You can upload up to 20 files at a time.' }, { status: 400 });
		}

		// Get user info for tracking
		const submittedBy = locals.user?.email || locals.user?.username || locals.user?.name || 'system';

		// Generate a unique job ID for this batch of files
		const jobId = `JobId-${crypto.randomUUID()}`;
		const batchSize = files.length.toString();

		// Track successful URLs and errors separately
		const presignedUrls: PresignedUrlResponse[] = [];
		const fileErrors: { fileName: string; error: string }[] = [];

		// Phase 1: Validate all files synchronously and collect metadata
		type ValidatedFile = {
			file: FileRequest;
			mapId: string;
			mapName: string;
			metadata: {
				originalFilename: string;
				submittedBy: string;
				mapId: string;
				jobId: string;
				batchSize: string;
			};
		};

		const validatedFiles: ValidatedFile[] = [];

		for (const file of files) {
			const lowerName = file.name.toLowerCase();

			// Basic file type validation
			if (!lowerName.endsWith('.zip')) {
				fileErrors.push({ fileName: file.name, error: `Only .zip files are allowed. ${file.name} is not supported.` });
				continue;
			}

			if (!ALLOWED_MIME.has(file.type)) {
				fileErrors.push({ fileName: file.name, error: `Unsupported MIME type ${file.type} for ${file.name}.` });
				continue;
			}

			// Parse and validate filename
			const parsed = parseMapFilename(file.name);
			if (!parsed.valid) {
				fileErrors.push({
					fileName: file.name,
					error: parsed.error || 'Invalid filename format'
				});
				continue;
			}

			// Create unique map ID from file hash (for deduplication)
			const mapId = `map_${file.hash}`;
			const mapName = sanitizeMapFilename(file.name);

			// This should never happen since we already validated, but double-check
			if (!mapName) {
				fileErrors.push({
					fileName: file.name,
					error: 'Failed to sanitize filename'
				});
				continue;
			}

			// Store metadata that will be passed to the Lambda when the file is uploaded
			const metadata = {
				originalFilename: file.name,
				submittedBy: submittedBy,
				mapId: mapId,
				jobId: jobId,
				batchSize: batchSize
			};

			validatedFiles.push({
				file,
				mapId,
				mapName,
				metadata
			});
		}

		// Phase 2: Check for duplicates in parallel (all DynamoDB queries at once)
		const duplicateCheckResults = await Promise.all(
			validatedFiles.map(async (vf) => {
				const checkResult = await checkMapExists(vf.mapId);
				return { validatedFile: vf, checkResult };
			})
		);

		// Phase 3: Process duplicate check results and collect files to upload
		const filesToUpload: ValidatedFile[] = [];

		for (const { validatedFile, checkResult } of duplicateCheckResults) {
			if (checkResult.exists && !checkResult.canRetry) {
				// File exists and we shouldn't retry (either processing or completed)
				let errorMsg = checkResult.reason || `${validatedFile.file.name} has already been processed`;
				// If uploaded with a different filename before, mention that
				if (checkResult.existingName && checkResult.existingName !== validatedFile.file.name) {
					errorMsg = `${validatedFile.file.name} (same content as previously uploaded "${checkResult.existingName}") - ${checkResult.reason || 'already processed'}`;
				}
				fileErrors.push({ fileName: validatedFile.file.name, error: errorMsg });
				continue;
			}

			// If we reach here, either it's a new file or a retry is allowed
			filesToUpload.push(validatedFile);
		}

		// Phase 4: Reserve mapIds atomically and generate presigned URLs
		// This prevents race conditions in multi-user scenarios
		const presignedUrlResults = await Promise.all(
			filesToUpload.map(async (vf) => {
				// Step 1: Reserve the mapId atomically (prevents multi-user duplicates)
				const reservation = await reserveMapId(
					vf.mapId,
					vf.mapName,
					submittedBy,
					jobId
				);

				if (!reservation.reserved) {
					// Another user already reserved this mapId
					let errorMsg = reservation.reason || 'Already being processed by another user';
					if (reservation.existingName && reservation.existingName !== vf.file.name) {
						errorMsg = `Same content as "${reservation.existingName}" - ${errorMsg}`;
					}
					return { error: errorMsg, fileName: vf.file.name };
				}

				// Step 2: Generate presigned URL (only if reservation succeeded)
				const command = new PutObjectCommand({
					Bucket: MAP_INPUT_BUCKET,
					Key: vf.mapName,
					ContentType: vf.file.type,
					Metadata: vf.metadata
				});

				const url = await getSignedUrl(getS3Client(), command, {
					expiresIn: PRESIGNED_URL_EXPIRY_SECONDS
				});

				return {
					url,
					key: vf.mapName,
					mapId: vf.mapId,
					metadata: vf.metadata
				};
			})
		);

		// Separate successful URLs from reservation failures
		for (const result of presignedUrlResults) {
			if ('error' in result) {
				fileErrors.push({ fileName: result.fileName, error: result.error });
			} else {
				presignedUrls.push(result);
			}
		}

		// Figure out what to return based on results
		const hasErrors = fileErrors.length > 0;
		const hasSuccessful = presignedUrls.length > 0;

		// If all files failed validation, return 400 error
		if (hasErrors && !hasSuccessful) {
			return json({ fileErrors }, { status: 400 });
		}

		// If some succeeded, return 200 with results (and errors if any)
		// Include rate limit headers in response
		return json(
			{
				jobId: hasSuccessful ? jobId : undefined,
				urls: presignedUrls,
				fileErrors: hasErrors ? fileErrors : undefined
			},
			{
				headers: {
					'X-RateLimit-Limit': rateLimit.limit.toString(),
					'X-RateLimit-Remaining': rateLimit.remaining.toString(),
					'X-RateLimit-Reset': rateLimit.resetTime.toString()
				}
			}
		);
	} catch (error) {
		console.error(`[presigned-url][${correlationId}] Failed to generate presigned URLs`, error);
		const errorMessage = error instanceof Error
			? `Failed to generate upload URLs: ${error.message}. Please try again.`
			: 'Failed to generate upload URLs. Please try again.';
		return json({ error: errorMessage }, { status: 500 });
	}
};
