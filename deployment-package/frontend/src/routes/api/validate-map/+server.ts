import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ApiErrors } from '$lib/server/api-response';
import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';

// Body size limit is configured via BODY_SIZE_LIMIT environment variable in Dockerfile (200MB)
export const POST: RequestHandler = async ({ request, locals }) => {
	const correlationId = locals.correlationId;

	// Rate limiting - prevent abuse of validation endpoint
	if (locals.user) {
		const rateLimitResult = checkRateLimit(locals.user.email, RateLimitPresets.GENEROUS);
		if (!rateLimitResult.allowed) {
			return ApiErrors.tooManyRequests(
				'Too many validation requests. Please try again later.',
				rateLimitResult.resetTime,
				{ correlationId }
			);
		}
	}

	try {
		// Get the uploaded file from form data
		const formData = await request.formData();
		const file = formData.get('file') as File;

		if (!file) {
			return ApiErrors.badRequest('No file provided', {
				correlationId,
				fieldErrors: { file: 'File is required' }
			});
		}

		// Validate file type
		if (!file.name.endsWith('.zip')) {
			return ApiErrors.badRequest('Only .zip files are supported', {
				correlationId,
				details: `Received file type: ${file.name.split('.').pop()}`
			});
		}

		// Create a temporary file to store the upload
		const tempFilePath = join(tmpdir(), `validate-${randomUUID()}.zip`);

		try {
			// Write uploaded file to temporary location
			const arrayBuffer = await file.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			await writeFile(tempFilePath, buffer);

			// Call Python validation script with original filename
			const pythonScript = join(process.cwd(), 'validate_map.py');
			const result = await runPythonValidation(pythonScript, tempFilePath, file.name);

			// Clean up temporary file
			await unlink(tempFilePath);

			return json(result);
		} catch (error) {
			// Clean up temporary file on error
			try {
				await unlink(tempFilePath);
			} catch {
				// Ignore cleanup errors
			}
			throw error;
		}
	} catch (error) {
		console.error('[validate-map] Validation error:', error);
		// Surface the specific error message to users instead of generic "Failed to validate map"
		const errorMessage = error instanceof Error ? error.message : 'Unknown validation error occurred';
		return ApiErrors.internalError(errorMessage, {
			correlationId,
			details: errorMessage
		});
	}
};

/**
 * Run Python validation script and return results with timeout
 */
function runPythonValidation(scriptPath: string, zipFilePath: string, originalFilename: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const python = spawn('python3', [scriptPath, zipFilePath, originalFilename]);

		let stdout = '';
		let stderr = '';
		let timeoutHandle: NodeJS.Timeout;

		// Set 10-second timeout for validation
		timeoutHandle = setTimeout(() => {
			python.kill();
			reject(new Error('Validation timeout - file processing took longer than 10 seconds'));
		}, 10000);

		python.stdout.on('data', (data) => {
			stdout += data.toString();
		});

		python.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		python.on('close', (code) => {
			clearTimeout(timeoutHandle);

			if (stderr) {
				console.error('[validate-map] Python validation stderr:', stderr);
			}

			try {
				// Parse JSON output from Python script
				const result = JSON.parse(stdout);
				resolve(result);
			} catch (e) {
				reject(
					new Error(
						`Failed to parse validation result. Exit code: ${code}, stdout: ${stdout}, stderr: ${stderr}`
					)
				);
			}
		});

		python.on('error', (error) => {
			clearTimeout(timeoutHandle);
			reject(new Error(`Failed to spawn Python process: ${error.message}`));
		});
	});
}
