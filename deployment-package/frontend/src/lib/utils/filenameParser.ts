/**
 * Shared filename parser - Frontend validation for map filenames
 * Used by: zipValidator, presigned-url, validate-map API
 *
 * This ensures consistent parsing across all frontend validation layers.
 *
 * IMPORTANT: This validation logic is intentionally duplicated in the Lambda backend
 * (infra/lambda/input_handler/handler.py:validate_filename) for defense-in-depth security.
 * Frontend validation provides immediate user feedback, while Lambda validation catches
 * files that bypass the frontend (e.g., direct S3 uploads, API calls).
 *
 * When modifying validation rules, update BOTH locations to maintain consistency.
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
 * - SeamID: MANDATORY, non-empty alphanumeric (everything before sheet number pattern)
 * - Underscore: MANDATORY separator
 * - SheetNumber: MANDATORY, exactly 6 digits in format XXXXXX or XX_XXXX
 *
 * The parser finds the 6-digit sheet number pattern first, then treats everything before it as the seam ID.
 *
 * Valid examples:
 * - 16516_433857.zip → {seamId: "16516", sheetNumber: "433857"}
 * - D723_43_3857.zip → {seamId: "D723", sheetNumber: "433857"}
 * - 43_433857.zip → {seamId: "43", sheetNumber: "433857"}
 * - 43_43_3857.zip → {seamId: "43", sheetNumber: "433857"}
 * - 17836_26_9285_UpperHirst.zip → {seamId: "17836", sheetNumber: "269285"}
 *
 * Invalid examples:
 * - _453858.zip (no seam ID before sheet number)
 * - 453858.zip (no underscore separator)
 * - 16516_4538.zip (only 4 digits in sheet number)
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

	// Look for 6-digit sheet number pattern in two formats:
	// Format 1: XX_XXXX (2 digits + separator + 4 digits)
	// Format 2: XXXXXX (6 consecutive digits)
	// Use regex with negative lookbehind to ensure pattern isn't preceded by digits

	const sheetNumberPattern = /(?<!\d)(\d{2}[-\s_]\d{4}|\d{6})(?=[-\s_]|$)/;
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
