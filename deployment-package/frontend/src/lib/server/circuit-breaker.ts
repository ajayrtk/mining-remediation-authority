/**
 * Circuit Breaker pattern implementation for AWS service calls
 *
 * Prevents cascading failures by:
 * - Tracking failure rates for external services
 * - Opening circuit when failure threshold exceeded
 * - Automatically attempting recovery after timeout
 * - Providing fast-fail responses when circuit is open
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests fail immediately
 * - HALF_OPEN: Testing if service recovered, allow limited requests
 */

enum CircuitState {
	CLOSED = 'CLOSED',
	OPEN = 'OPEN',
	HALF_OPEN = 'HALF_OPEN'
}

interface CircuitBreakerConfig {
	/** Name of the service/circuit for logging */
	name: string;
	/** Number of failures before opening circuit */
	failureThreshold: number;
	/** Time window in ms to track failures */
	failureWindowMs: number;
	/** How long to wait before attempting recovery (ms) */
	resetTimeoutMs: number;
	/** Number of successful calls needed in HALF_OPEN to close circuit */
	successThreshold: number;
}

interface CircuitStats {
	state: CircuitState;
	failures: number;
	successes: number;
	lastFailureTime: number;
	nextAttemptTime: number;
}

/**
 * Circuit breaker for protecting against cascading failures
 */
export class CircuitBreaker {
	private config: CircuitBreakerConfig;
	private stats: CircuitStats;
	private failureTimestamps: number[] = [];

	constructor(config: CircuitBreakerConfig) {
		this.config = config;
		this.stats = {
			state: CircuitState.CLOSED,
			failures: 0,
			successes: 0,
			lastFailureTime: 0,
			nextAttemptTime: 0
		};
	}

	/**
	 * Execute a function with circuit breaker protection
	 */
	async execute<T>(fn: () => Promise<T>): Promise<T> {
		// Check if circuit should transition to HALF_OPEN
		if (this.stats.state === CircuitState.OPEN) {
			const now = Date.now();
			if (now >= this.stats.nextAttemptTime) {
				console.log(`[circuit-breaker][${this.config.name}] Attempting recovery (OPEN → HALF_OPEN)`);
				this.stats.state = CircuitState.HALF_OPEN;
				this.stats.successes = 0;
			} else {
				const waitSeconds = Math.ceil((this.stats.nextAttemptTime - now) / 1000);
				throw new Error(
					`Circuit breaker is OPEN for ${this.config.name}. Service is temporarily unavailable. Retry in ${waitSeconds}s.`
				);
			}
		}

		try {
			const result = await fn();
			this.onSuccess();
			return result;
		} catch (error) {
			this.onFailure();
			throw error;
		}
	}

	private onSuccess(): void {
		this.cleanupOldFailures();

		if (this.stats.state === CircuitState.HALF_OPEN) {
			this.stats.successes++;
			console.log(
				`[circuit-breaker][${this.config.name}] Success in HALF_OPEN (${this.stats.successes}/${this.config.successThreshold})`
			);

			// If we hit success threshold, close the circuit
			if (this.stats.successes >= this.config.successThreshold) {
				console.log(`[circuit-breaker][${this.config.name}] Recovery successful (HALF_OPEN → CLOSED)`);
				this.stats.state = CircuitState.CLOSED;
				this.stats.failures = 0;
				this.stats.successes = 0;
				this.failureTimestamps = [];
			}
		}
	}

	private onFailure(): void {
		const now = Date.now();
		this.stats.lastFailureTime = now;
		this.failureTimestamps.push(now);
		this.cleanupOldFailures();

		if (this.stats.state === CircuitState.HALF_OPEN) {
			// If we fail in HALF_OPEN, go back to OPEN
			console.warn(`[circuit-breaker][${this.config.name}] Failed during recovery (HALF_OPEN → OPEN)`);
			this.openCircuit();
			return;
		}

		if (this.stats.state === CircuitState.CLOSED) {
			// Check if we exceeded failure threshold
			if (this.failureTimestamps.length >= this.config.failureThreshold) {
				console.error(
					`[circuit-breaker][${this.config.name}] Failure threshold exceeded (${this.failureTimestamps.length}/${this.config.failureThreshold}) (CLOSED → OPEN)`
				);
				this.openCircuit();
			}
		}
	}

	private openCircuit(): void {
		this.stats.state = CircuitState.OPEN;
		this.stats.nextAttemptTime = Date.now() + this.config.resetTimeoutMs;
		this.stats.successes = 0;
	}

	private cleanupOldFailures(): void {
		const cutoff = Date.now() - this.config.failureWindowMs;
		this.failureTimestamps = this.failureTimestamps.filter((ts) => ts > cutoff);
	}

	/**
	 * Get current circuit breaker state for monitoring
	 */
	getStats(): Readonly<CircuitStats> {
		return { ...this.stats };
	}

	/**
	 * Manually reset the circuit breaker (for testing or manual intervention)
	 */
	reset(): void {
		this.stats.state = CircuitState.CLOSED;
		this.stats.failures = 0;
		this.stats.successes = 0;
		this.stats.lastFailureTime = 0;
		this.stats.nextAttemptTime = 0;
		this.failureTimestamps = [];
		console.log(`[circuit-breaker][${this.config.name}] Manually reset to CLOSED`);
	}
}

/**
 * Preset circuit breaker configurations for different AWS services
 */
export const CircuitBreakerPresets = {
	/** DynamoDB - more tolerant of temporary throttling */
	DYNAMODB: {
		name: 'DynamoDB',
		failureThreshold: 5,
		failureWindowMs: 60 * 1000, // 1 minute
		resetTimeoutMs: 30 * 1000, // 30 seconds
		successThreshold: 3
	},
	/** S3 - very reliable, open quickly on repeated failures */
	S3: {
		name: 'S3',
		failureThreshold: 3,
		failureWindowMs: 30 * 1000, // 30 seconds
		resetTimeoutMs: 20 * 1000, // 20 seconds
		successThreshold: 2
	},
	/** ECS - can have longer delays during deployments */
	ECS: {
		name: 'ECS',
		failureThreshold: 5,
		failureWindowMs: 120 * 1000, // 2 minutes
		resetTimeoutMs: 60 * 1000, // 1 minute
		successThreshold: 3
	}
} as const;

// Global circuit breakers for each service
export const dynamoCircuitBreaker = new CircuitBreaker(CircuitBreakerPresets.DYNAMODB);
export const s3CircuitBreaker = new CircuitBreaker(CircuitBreakerPresets.S3);
export const ecsCircuitBreaker = new CircuitBreaker(CircuitBreakerPresets.ECS);
