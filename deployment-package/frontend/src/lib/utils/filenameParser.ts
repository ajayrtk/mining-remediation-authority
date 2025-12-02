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
	const firstUnderscoreIndex = nameWithoutExt.indexOf('_');
	if (firstUnderscoreIndex === -1) {
		return {
			seamId: '',
			sheetNumber: '',
			valid: false,
			error: `Missing mandatory underscore separator. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')`
		};
	}

	// Split on first underscore: SeamID is before, sheet number part is after
	const seamIdClean = nameWithoutExt.substring(0, firstUnderscoreIndex);
	const sheetPart = nameWithoutExt.substring(firstUnderscoreIndex + 1);

	// Validate seam ID is not empty
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

	// Look for 6-digit sheet number pattern in the sheet part only
	// Format 1: XX_XXXX (2 digits + separator + 4 digits)
	// Format 2: XXXXXX (6 consecutive digits)
	// Use negative lookbehind/lookahead to ensure pattern is exactly 6 digits (not part of longer number)
	const sheetNumberPattern = /(?<!\d)(\d{2}[-\s_]\d{4}|\d{6})(?!\d)/;
	const match = sheetPart.match(sheetNumberPattern);

	if (!match) {
		// No valid sheet number pattern found - count digits only in sheet part
		const sheetDigits = sheetPart.replace(/\D/g, '');
		if (sheetDigits.length === 0) {
			return {
				seamId: seamIdClean,
				sheetNumber: '',
				valid: false,
				error: `No digits found in sheet number part. Sheet number must be exactly 6 digits in format XXXXXX or XX_XXXX.`
			};
		} else if (sheetDigits.length < 6) {
			return {
				seamId: seamIdClean,
				sheetNumber: '',
				valid: false,
				error: `Sheet number must be exactly 6 digits, found ${sheetDigits.length} digits. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip' or 'D723_43_3857.zip')`
			};
		} else {
			return {
				seamId: seamIdClean,
				sheetNumber: '',
				valid: false,
				error: `Sheet number has ${sheetDigits.length} digits but must be exactly 6 digits (format XXXXXX or XX_XXXX).`
			};
		}
	}

	// Extract sheet number (remove any separators to get 6 digits)
	const sheetNumberRaw = match[1];
	const sheetNumber = sheetNumberRaw.replace(/\D/g, '');

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
