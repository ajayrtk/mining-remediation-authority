import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// Body size limit is configured via BODY_SIZE_LIMIT environment variable in Dockerfile (200MB)
export const POST: RequestHandler = async ({ request }) => {
	console.log('[validate-map API] Validation request received');
	try {
		// Get the uploaded file from form data
		const formData = await request.formData();
		const file = formData.get('file') as File;
		console.log('[validate-map API] File received:', file ? file.name : 'no file');

		if (!file) {
			console.log('[validate-map API] No file provided');
			return json({ error: 'No file provided' }, { status: 400 });
		}

		// Validate file type
		if (!file.name.endsWith('.zip')) {
			console.log('[validate-map API] Invalid file type:', file.name);
			return json({ error: 'Only .zip files are supported' }, { status: 400 });
		}
		console.log('[validate-map API] File type valid, proceeding with validation');

		// Create a temporary file to store the upload
		const tempFilePath = join(tmpdir(), `validate-${randomUUID()}.zip`);

		try {
			// Write uploaded file to temporary location
			const arrayBuffer = await file.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			await writeFile(tempFilePath, buffer);

			// Call Python validation script with original filename
			const pythonScript = join(process.cwd(), 'validate_map.py');
			console.log('[validate-map API] Calling Python script:', pythonScript);
			console.log('[validate-map API] Original filename:', file.name);
			const result = await runPythonValidation(pythonScript, tempFilePath, file.name);
			console.log('[validate-map API] Python validation result:', JSON.stringify(result));

			// Clean up temporary file
			await unlink(tempFilePath);

			console.log('[validate-map API] Returning result to client');
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
		console.error('Validation error:', error);
		return json(
			{
				error: 'Failed to validate map',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
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
				console.error('Python validation stderr:', stderr);
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
