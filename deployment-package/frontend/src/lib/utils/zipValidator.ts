// ZIP file validation - validates images and georeferencing files before upload

import { parseMapFilename } from './filenameParser';

export type ValidationResult = {
	valid: boolean;
	fileName: string;
	error?: string;
	warnings?: string[];
	imagesFound?: string[];
	seamId?: string;
	sheetNumber?: string;
};


function isValidImage(filename: string): { valid: boolean; type?: 'jpg' | 'tif' } {
	const lower = filename.toLowerCase();

	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
		return { valid: true, type: 'jpg' };
	}

	if (lower.endsWith('.tif') || lower.endsWith('.tiff')) {
		return { valid: true, type: 'tif' };
	}

	return { valid: false };
}

function isWorldFile(filename: string): boolean {
	const lower = filename.toLowerCase();
	const worldExtensions = ['.jgw', '.jgwx', '.tfw', '.tifw', '.tiffw', '.pgw', '.pngw'];
	return worldExtensions.some(ext => lower.endsWith(ext));
}

function getExpectedWorldFiles(imageName: string): string[] {
	const baseName = imageName.replace(/\.(jpg|jpeg|tif|tiff)$/i, '');
	const lower = imageName.toLowerCase();

	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
		return [`${baseName}.jgw`, `${baseName}.jgwx`];
	}

	if (lower.endsWith('.tif') || lower.endsWith('.tiff')) {
		return [`${baseName}.tfw`, `${baseName}.tifw`, `${baseName}.tiffw`];
	}

	if (lower.endsWith('.png')) {
		return [`${baseName}.pgw`, `${baseName}.pngw`];
	}

	return [];
}

export async function validateZipFile(file: File): Promise<ValidationResult> {
	const result: ValidationResult = {
		valid: false,
		fileName: file.name,
		warnings: []
	};

	// Check file type
	if (!file.name.toLowerCase().endsWith('.zip')) {
		result.error = 'File must be a ZIP archive';
		return result;
	}

	// Validate ZIP filename format (SeamID_SheetNumber.zip)
	const zipFilenameInfo = parseMapFilename(file.name);
	if (!zipFilenameInfo.valid) {
		result.error = zipFilenameInfo.error || 'Invalid ZIP filename format';
		return result;
	}

	result.seamId = zipFilenameInfo.seamId;
	result.sheetNumber = zipFilenameInfo.sheetNumber;

	try {
		// Use JSZip to read the archive
		const JSZip = (await import('jszip')).default;
		const zip = await JSZip.loadAsync(file);

		// Find all files, images, and world files
		const allFiles: string[] = [];
		const validImages: { name: string; type: 'jpg' | 'tif' }[] = [];
		const worldFiles: string[] = [];

		zip.forEach((relativePath, zipEntry) => {
			// Skip directories
			if (zipEntry.dir) return;

			const fileName = relativePath.split('/').pop() || relativePath;

			// Skip macOS metadata files (starting with ._ or .)
			if (fileName.startsWith('._') || fileName.startsWith('.')) {
				return;
			}

			// Track all files (excluding hidden/metadata files)
			allFiles.push(relativePath);

			const imageCheck = isValidImage(fileName);

			if (imageCheck.valid && imageCheck.type) {
				validImages.push({
					name: relativePath,
					type: imageCheck.type
				});
			}

			// Track world files
			if (isWorldFile(fileName)) {
				worldFiles.push(relativePath);
			}
		});

		// Validation: must contain at least one valid image
		if (validImages.length === 0) {
			result.error = 'ZIP must contain at least one .jpg or .tif image';
			return result;
		}

		// Validation: Check world file requirements based on image type
		const missingWorldFiles: string[] = [];

		for (const image of validImages) {
			const imageFileName = image.name.split('/').pop() || image.name;
			const expectedWorldFiles = getExpectedWorldFiles(imageFileName);

			// Check if at least one expected world file exists
			const hasWorldFile = expectedWorldFiles.some(expectedWorld => {
				return worldFiles.some(worldFile => {
					const worldFileName = worldFile.split('/').pop() || worldFile;
					return worldFileName.toLowerCase() === expectedWorld.toLowerCase();
				});
			});

			// World files are REQUIRED for JPEG/JPG, OPTIONAL for TIFF
			if (!hasWorldFile && image.type === 'jpg') {
				missingWorldFiles.push(imageFileName);
			}
		}

		if (missingWorldFiles.length > 0) {
			result.error = `Missing required world files for JPEG images: ${missingWorldFiles.join(', ')}. Each JPEG/JPG image must have a corresponding .jgw or .jgwx world file for georeferencing.`;
			return result;
		}

		// Validation: Validate image filenames contain sheet number
		for (const image of validImages) {
			const imageFileName = image.name.split('/').pop() || image.name;
			const imageFileInfo = parseMapFilename(imageFileName);

			if (!imageFileInfo.valid) {
				result.error = `Invalid image filename: ${imageFileName}. ${imageFileInfo.error}`;
				return result;
			}

			// Check if sheet number matches ZIP sheet number
			if (imageFileInfo.sheetNumber !== zipFilenameInfo.sheetNumber) {
				result.error = `Sheet number mismatch: Image file ${imageFileName} has sheet number ${imageFileInfo.sheetNumber} but ZIP file has ${zipFilenameInfo.sheetNumber}. All files must have matching sheet numbers.`;
				return result;
			}
		}

		// Success - all validations passed
		result.valid = true;
		result.imagesFound = validImages.map(img => img.name);

		return result;

	} catch (error) {
		result.error = `Failed to read ZIP file: ${error instanceof Error ? error.message : 'Unknown error'}`;
		return result;
	}
}

export async function validateZipFiles(files: File[]): Promise<ValidationResult[]> {
	return Promise.all(files.map(file => validateZipFile(file)));
}

export function allValid(results: ValidationResult[]): boolean {
	return results.every(r => r.valid);
}
