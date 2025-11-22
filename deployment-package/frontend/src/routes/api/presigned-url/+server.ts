// Presigned URL API - generates signed URLs for direct S3 uploads
// Checks for duplicates and handles retry logic for failed uploads

import { parseMapFilename, sanitizeMapFilename } from '$lib/utils/filenameParser';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { json } from '@sveltejs/kit';
import { MAPS_TABLE, dynamoDocClient } from '$lib/server/dynamo';
import { MAP_INPUT_BUCKET, getS3Client } from '$lib/server/s3';
import type { RequestHandler } from './$types';

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
				// If it's been processing for over 30 minutes, something's wrong
				if (ageMinutes > 30) {
					canRetry = true;
					reason = 'Processing timeout detected (>30 min), retry allowed';
				} else {
					canRetry = false;
					reason = 'File is currently being processed, please wait';
				}
			} else if (!status || status === 'QUEUED') {
				// File is queued but hasn't started - check if it's stale
				// If queued for over 10 minutes, probably stuck
				if (ageMinutes > 10) {
					canRetry = true;
					reason = 'Stale pending job detected (>10 min), retry allowed';
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
		console.error(`Failed to check if map ${mapId} exists`, error);
		// If we can't check, err on the side of allowing upload
		return { exists: false, canRetry: true };
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
	console.log('[Backend Auth Check] locals.user:', locals.user ? 'authenticated' : 'NOT authenticated');

	// Make sure user is authenticated before allowing uploads
	if (!locals.user) {
		console.error('[Backend Auth] User not authenticated in locals');
		return json({ error: 'Please sign in to upload files.' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const files = body.files as FileRequest[];

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
			if (checkResult.exists && checkResult.canRetry) {
				console.log(`[Retry] Allowing retry for ${validatedFile.file.name} (mapId: ${validatedFile.mapId}, reason: ${checkResult.reason})`);
			}

			filesToUpload.push(validatedFile);
		}

		// Phase 4: Generate presigned URLs in parallel (all S3 operations at once)
		const presignedUrlResults = await Promise.all(
			filesToUpload.map(async (vf) => {
				const command = new PutObjectCommand({
					Bucket: MAP_INPUT_BUCKET,
					Key: vf.mapName,
					ContentType: vf.file.type,
					Metadata: vf.metadata
				});

				const url = await getSignedUrl(getS3Client(), command, {
					expiresIn: 3600 // URL expires in 1 hour
				});

				return {
					url,
					key: vf.mapName,
					mapId: vf.mapId,
					metadata: vf.metadata
				};
			})
		);

		presignedUrls.push(...presignedUrlResults);

		// Figure out what to return based on results
		const hasErrors = fileErrors.length > 0;
		const hasSuccessful = presignedUrls.length > 0;

		if (hasErrors) {
			console.log('[Backend] Returning fileErrors:', JSON.stringify(fileErrors, null, 2));
		}

		// If all files failed validation, return 400 error
		if (hasErrors && !hasSuccessful) {
			return json({ fileErrors }, { status: 400 });
		}

		// If some succeeded, return 200 with results (and errors if any)
		return json({
			jobId: hasSuccessful ? jobId : undefined,
			urls: presignedUrls,
			fileErrors: hasErrors ? fileErrors : undefined
		});
	} catch (error) {
		console.error('Failed to generate presigned URLs', error);
		return json({ error: 'Failed to generate upload URLs. Please try again.' }, { status: 500 });
	}
};
