// In-memory rate limiter with sliding window algorithm

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
	maxRequests: number;
	windowMs: number;
	keyFunction?: (identifier: string) => string;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetTime: number;
	limit: number;
}

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

export const RateLimitPresets = {
	STRICT: {
		maxRequests: 50,
		windowMs: 60 * 1000
	},
	STANDARD: {
		maxRequests: 300,
		windowMs: 60 * 1000
	},
	API: {
		maxRequests: 500,
		windowMs: 60 * 1000
	},
	GENEROUS: {
		maxRequests: 1500,
		windowMs: 60 * 1000
	},
	UPLOAD: {
		maxRequests: 100,
		windowMs: 60 * 60 * 1000
	}
} as const;
