// Filename parser for map files (SeamID_SheetNumber.zip format)
// Note: Validation logic duplicated in Lambda backend for defense-in-depth

export interface ParsedFilename {
	seamId: string;
	sheetNumber: string;
	valid: boolean;
	error?: string;
}

// Extracts SeamID and SheetNumber from filename
// Format: SeamID_SheetNumber[_optional_suffix].zip
// Examples: 16516_433857.zip, D723_43_3857.zip
export function parseMapFilename(filename: string): ParsedFilename {
	// Remove file extension
	const nameWithoutExt = filename.replace(/\.(zip|jpg|jpeg|tif|tiff)$/i, '');

	// Check for mandatory underscore
	if (!nameWithoutExt.includes('_')) {
		return {
			seamId: '',
			sheetNumber: '',
			valid: false,
			error: `Missing mandatory underscore separator. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')`
		};
	}

	// Look for 6-digit sheet number pattern in two formats:
	// Format 1: XX_XXXX (2 digits + separator + 4 digits)
	// Format 2: XXXXXX (6 consecutive digits)
	// Use regex with negative lookbehind to ensure pattern isn't preceded by digits

	const sheetNumberPattern = /(?<!\d)(\d{2}[-\s_]\d{4}|\d{6})/;
	const match = nameWithoutExt.match(sheetNumberPattern);

	if (!match) {
		// No valid sheet number pattern found
		const allDigits = nameWithoutExt.replace(/\D/g, '');
		if (allDigits.length === 0) {
			return {
				seamId: '',
				sheetNumber: '',
				valid: false,
				error: `No digits found. Sheet number must be exactly 6 digits in format XXXXXX or XX_XXXX.`
			};
		} else if (allDigits.length < 6) {
			return {
				seamId: '',
				sheetNumber: '',
				valid: false,
				error: `Sheet number must be exactly 6 digits, found ${allDigits.length} digits. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip' or '43_43_3857.zip')`
			};
		} else {
			return {
				seamId: '',
				sheetNumber: '',
				valid: false,
				error: `Found ${allDigits.length} digits but sheet number format is incorrect. Expected 6 digits in format XXXXXX or XX_XXXX (e.g., '433857' or '43_3857').`
			};
		}
	}

	// Extract sheet number (remove any separators to get 6 digits)
	const sheetNumberRaw = match[1];
	const sheetNumber = sheetNumberRaw.replace(/\D/g, '');

	// Everything before the sheet number pattern is the seam ID
	const sheetNumberStartIndex = match.index!;
	const seamId = nameWithoutExt.substring(0, sheetNumberStartIndex);

	// Validate seam ID exists and ends with underscore
	if (!seamId || !seamId.endsWith('_')) {
		return {
			seamId: '',
			sheetNumber: '',
			valid: false,
			error: `Missing mandatory seam ID before sheet number. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')`
		};
	}

	// Remove trailing underscore from seam ID
	const seamIdClean = seamId.slice(0, -1);

	// Validate seam ID is not empty after removing underscore
	if (!seamIdClean || seamIdClean.trim() === '') {
		return {
			seamId: '',
			sheetNumber: '',
			valid: false,
			error: `Missing mandatory seam ID before underscore. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')`
		};
	}

	// Validate seam ID contains only alphanumeric characters
	if (!/^[a-zA-Z0-9]+$/.test(seamIdClean)) {
		return {
			seamId: seamIdClean,
			sheetNumber: '',
			valid: false,
			error: `Invalid seam ID '${seamIdClean}'. Seam ID must contain only letters and numbers.`
		};
	}

	return {
		seamId: seamIdClean,
		sheetNumber: sheetNumber,
		valid: true
	};
}

export function sanitizeMapFilename(filename: string): string | null {
	const parsed = parseMapFilename(filename);

	if (!parsed.valid) {
		return null; // Cannot sanitize invalid filename
	}

	// Extract original extension
	const extMatch = filename.match(/\.(zip|ZIP)$/i);
	const ext = extMatch ? extMatch[0] : '.zip';

	// Return standardized format
	return `${parsed.seamId}_${parsed.sheetNumber}${ext}`;
}
