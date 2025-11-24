/**
 * Simple in-memory rate limiter for API endpoints
 *
 * Prevents abuse by limiting requests per user per time window
 * Uses sliding window algorithm for accurate rate limiting
 */

interface RateLimitEntry {
	count: number;
	resetTime: number;
}

// In-memory store for rate limit tracking
// In production, consider using Redis for distributed rate limiting
const rateLimitStore = new Map<string, RateLimitEntry>();

// Track last cleanup time to avoid frequent cleanups
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Lazy cleanup of expired entries (called on each rate limit check)
 * More efficient than setInterval in serverless environments
 */
function cleanupExpiredEntries(): void {
	const now = Date.now();

	// Only cleanup if enough time has passed since last cleanup
	if (now - lastCleanup < CLEANUP_INTERVAL_MS) {
		return;
	}

	lastCleanup = now;

	for (const [key, entry] of rateLimitStore.entries()) {
		if (entry.resetTime < now) {
			rateLimitStore.delete(key);
		}
	}
}

export interface RateLimitConfig {
	/** Maximum number of requests allowed in the time window */
	maxRequests: number;
	/** Time window in milliseconds */
	windowMs: number;
	/** Optional custom key function (defaults to user email) */
	keyFunction?: (identifier: string) => string;
}

export interface RateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Number of requests remaining in current window */
	remaining: number;
	/** Time when the rate limit resets (Unix timestamp) */
	resetTime: number;
	/** Total limit */
	limit: number;
}

/**
 * Check if a request should be rate limited
 *
 * @param identifier - Unique identifier (usually user email)
 * @param config - Rate limit configuration
 * @returns Rate limit result with allowed status and metadata
 */
export function checkRateLimit(
	identifier: string,
	config: RateLimitConfig
): RateLimitResult {
	// Perform lazy cleanup of expired entries
	cleanupExpiredEntries();

	const key = config.keyFunction ? config.keyFunction(identifier) : identifier;
	const now = Date.now();

	// Get or create rate limit entry
	let entry = rateLimitStore.get(key);

	// If entry doesn't exist or window has expired, create new entry
	if (!entry || entry.resetTime < now) {
		entry = {
			count: 0,
			resetTime: now + config.windowMs
		};
		rateLimitStore.set(key, entry);
	}

	// Increment request count
	entry.count++;

	// Check if limit exceeded
	const allowed = entry.count <= config.maxRequests;
	const remaining = Math.max(0, config.maxRequests - entry.count);

	return {
		allowed,
		remaining,
		resetTime: entry.resetTime,
		limit: config.maxRequests
	};
}

/**
 * Preset rate limit configurations for common use cases
 */
export const RateLimitPresets = {
	/** Strict limit for expensive operations (10 requests per minute) */
	STRICT: {
		maxRequests: 10,
		windowMs: 60 * 1000
	},
	/** Standard limit for normal API endpoints (60 requests per minute) */
	STANDARD: {
		maxRequests: 60,
		windowMs: 60 * 1000
	},
	/** API limit for general API operations (100 requests per minute) */
	API: {
		maxRequests: 100,
		windowMs: 60 * 1000
	},
	/** Generous limit for lightweight operations (300 requests per minute) */
	GENEROUS: {
		maxRequests: 300,
		windowMs: 60 * 1000
	},
	/** Upload limit (20 uploads per hour to prevent abuse) */
	UPLOAD: {
		maxRequests: 20,
		windowMs: 60 * 60 * 1000
	}
} as const;
