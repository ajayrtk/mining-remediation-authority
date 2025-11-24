import { describe, it, expect } from 'vitest';
import { parseMapFilename, sanitizeMapFilename } from './filenameParser';

describe('parseMapFilename', () => {
	it('should parse valid filename with 5-digit codes', () => {
		const result = parseMapFilename('16516_433857.zip');
		expect(result.valid).toBe(true);
		expect(result.sheet).toBe('16516');
		expect(result.grid).toBe('433857');
	});

	it('should parse valid filename with 6-digit codes', () => {
		const result = parseMapFilename('165169_4338574.zip');
		expect(result.valid).toBe(true);
		expect(result.sheet).toBe('165169');
		expect(result.grid).toBe('4338574');
	});

	it('should reject filename without .zip extension', () => {
		const result = parseMapFilename('16516_433857.pdf');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('.zip');
	});

	it('should reject filename with invalid format', () => {
		const result = parseMapFilename('invalid-filename.zip');
		expect(result.valid).toBe(false);
		expect(result.error).toBeTruthy();
	});

	it('should reject filename with non-numeric codes', () => {
		const result = parseMapFilename('abc12_45678.zip');
		expect(result.valid).toBe(false);
		expect(result.error).toBeTruthy();
	});

	it('should handle uppercase .ZIP extension', () => {
		const result = parseMapFilename('16516_433857.ZIP');
		expect(result.valid).toBe(true);
	});
});

describe('sanitizeMapFilename', () => {
	it('should return sanitized filename for valid input', () => {
		const result = sanitizeMapFilename('16516_433857.zip');
		expect(result).toBe('16516_433857.zip');
	});

	it('should return null for invalid filename', () => {
		const result = sanitizeMapFilename('invalid.zip');
		expect(result).toBeNull();
	});

	it('should normalize case', () => {
		const result = sanitizeMapFilename('16516_433857.ZIP');
		expect(result).toBe('16516_433857.zip');
	});
});
