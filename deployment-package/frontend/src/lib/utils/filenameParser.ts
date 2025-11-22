/**
 * Shared filename parser - Single source of truth for map filename validation
 * Used by: zipValidator, presigned-url, validate-map API
 *
 * This ensures consistent parsing across all validation layers
 */

export interface ParsedFilename {
	seamId: string;
	sheetNumber: string;
	valid: boolean;
	error?: string;
}

/**
 * Parse map filename to extract SeamID and SheetNumber
 *
 * Format: SeamID_SheetNumber[_optional_suffix].zip
 * - SeamID: MANDATORY, non-empty alphanumeric (before first underscore)
 * - Underscore: MANDATORY separator
 * - SheetNumber: MANDATORY, exactly 6 digits in format XXXXXX or XX_XXXX
 *
 * Valid examples:
 * - 16516_433857.zip → {seamId: "16516", sheetNumber: "433857"}
 * - D723_43_3857.zip → {seamId: "D723", sheetNumber: "433857"}
 * - 17836_26_9285_UpperHirst.zip → {seamId: "17836", sheetNumber: "269285"}
 *
 * Invalid examples:
 * - _453858.zip (no seam ID)
 * - 453858.zip (no underscore)
 * - 16516_4538.zip (only 4 digits)
 */
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

	// Split at first underscore only
	const firstUnderscoreIndex = nameWithoutExt.indexOf('_');
	const seamId = nameWithoutExt.substring(0, firstUnderscoreIndex);
	const afterSeamId = nameWithoutExt.substring(firstUnderscoreIndex + 1);

	// Validate seam ID exists and is non-empty
	if (!seamId || seamId.trim() === '') {
		return {
			seamId: '',
			sheetNumber: '',
			valid: false,
			error: `Missing mandatory seam ID before underscore. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')`
		};
	}

	// Validate seam ID contains only alphanumeric characters
	if (!/^[a-zA-Z0-9]+$/.test(seamId)) {
		return {
			seamId: seamId,
			sheetNumber: '',
			valid: false,
			error: `Invalid seam ID '${seamId}'. Seam ID must contain only letters and numbers.`
		};
	}

	// Check if sheet number part exists
	if (!afterSeamId || afterSeamId.trim() === '') {
		return {
			seamId: seamId,
			sheetNumber: '',
			valid: false,
			error: `Missing sheet number after underscore. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')`
		};
	}

	// Look for exactly 6 digits in two possible formats:
	// 1. XX_XXXX - 2 digits + optional separator + 4 digits (e.g., 43_3857)
	// 2. XXXXXX - 6 consecutive digits (e.g., 433857)

	// Try format 1: 2 digits + separator + 4 digits
	const format1Match = afterSeamId.match(/^(\d{2})[-\s_](\d{4})(?:[-\s_]|$)/);
	if (format1Match) {
		const sheetNumber = format1Match[1] + format1Match[2];
		return {
			seamId: seamId,
			sheetNumber: sheetNumber,
			valid: true
		};
	}

	// Try format 2: 6 consecutive digits
	const format2Match = afterSeamId.match(/^(\d{6})(?:[-\s_]|$)/);
	if (format2Match) {
		return {
			seamId: seamId,
			sheetNumber: format2Match[1],
			valid: true
		};
	}

	// If we get here, no valid 6-digit pattern was found
	// Count how many digits we actually have for better error message
	const allDigits = afterSeamId.replace(/\D/g, '');

	if (allDigits.length === 0) {
		return {
			seamId: seamId,
			sheetNumber: '',
			valid: false,
			error: `No digits found in sheet number part. Sheet number must be exactly 6 digits.`
		};
	} else if (allDigits.length < 6) {
		return {
			seamId: seamId,
			sheetNumber: '',
			valid: false,
			error: `Sheet number must be exactly 6 digits, found ${allDigits.length} digits. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip' or '16516_43_3857.zip')`
		};
	} else if (allDigits.length > 6) {
		return {
			seamId: seamId,
			sheetNumber: '',
			valid: false,
			error: `Sheet number has too many digits (${allDigits.length}). First 6 digits must be at the start after seam ID, format: XXXXXX or XX_XXXX.`
		};
	} else {
		// Exactly 6 digits but not at the start
		return {
			seamId: seamId,
			sheetNumber: '',
			valid: false,
			error: `Sheet number format is incorrect. Expected 6 digits immediately after first underscore in format XXXXXX or XX_XXXX. Valid examples: '16516_433857.zip' or '16516_43_3857.zip'`
		};
	}
}

/**
 * Sanitize filename to standard format: SeamID_SheetNumber.zip
 * Used for S3 key generation to ensure consistency
 *
 * @param filename Original filename to sanitize
 * @returns Sanitized filename or null if invalid
 */
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
