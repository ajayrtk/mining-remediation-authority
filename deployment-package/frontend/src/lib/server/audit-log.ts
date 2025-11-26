/**
 * Audit logging system for tracking critical operations
 *
 * Logs security-relevant events like:
 * - Authentication attempts
 * - File uploads/downloads/deletions
 * - Map retries
 * - Configuration changes
 * - API access patterns
 *
 * In production, these logs should be sent to a centralized logging system
 * like CloudWatch Logs, Datadog, or similar for analysis and alerting.
 */

export enum AuditEventType {
	// Authentication events
	AUTH_SUCCESS = 'AUTH_SUCCESS',
	AUTH_FAILURE = 'AUTH_FAILURE',
	AUTH_LOGOUT = 'AUTH_LOGOUT',

	// Upload events
	UPLOAD_INITIATED = 'UPLOAD_INITIATED',
	UPLOAD_SUCCESS = 'UPLOAD_SUCCESS',
	UPLOAD_FAILURE = 'UPLOAD_FAILURE',
	UPLOAD_REJECTED = 'UPLOAD_REJECTED', // Rate limit, validation, etc.

	// Download events
	DOWNLOAD_INITIATED = 'DOWNLOAD_INITIATED',
	DOWNLOAD_SUCCESS = 'DOWNLOAD_SUCCESS',
	DOWNLOAD_FAILURE = 'DOWNLOAD_FAILURE',

	// Delete events
	DELETE_INITIATED = 'DELETE_INITIATED',
	DELETE_SUCCESS = 'DELETE_SUCCESS',
	DELETE_FAILURE = 'DELETE_FAILURE',

	// Retry events
	RETRY_INITIATED = 'RETRY_INITIATED',
	RETRY_SUCCESS = 'RETRY_SUCCESS',
	RETRY_FAILURE = 'RETRY_FAILURE',

	// Rate limiting events
	RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
	RATE_LIMIT_WARNING = 'RATE_LIMIT_WARNING', // e.g., 80% of limit reached

	// Security events
	UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
	FORBIDDEN_ACCESS = 'FORBIDDEN_ACCESS',
	SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',

	// System events
	SERVICE_ERROR = 'SERVICE_ERROR',
	SERVICE_DEGRADED = 'SERVICE_DEGRADED'
}

export enum AuditSeverity {
	INFO = 'INFO',
	WARNING = 'WARNING',
	ERROR = 'ERROR',
	CRITICAL = 'CRITICAL'
}

export interface AuditLogEntry {
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Type of event */
	eventType: AuditEventType;
	/** Severity level */
	severity: AuditSeverity;
	/** User email/identifier (if applicable) */
	userId?: string;
	/** Correlation ID for request tracing */
	correlationId?: string;
	/** Resource being accessed (e.g., mapId, jobId) */
	resourceId?: string;
	/** Type of resource */
	resourceType?: 'map' | 'job' | 'file' | 'user';
	/** Action performed */
	action: string;
	/** Result of the action */
	result: 'success' | 'failure' | 'rejected';
	/** Client IP address */
	ipAddress?: string;
	/** User agent string */
	userAgent?: string;
	/** Additional context data */
	metadata?: Record<string, any>;
	/** Error message if applicable */
	errorMessage?: string;
}

/**
 * Log an audit event
 * In production, this should send to CloudWatch Logs or similar
 */
export function logAuditEvent(entry: Omit<AuditLogEntry, 'timestamp'>): void {
	const fullEntry: AuditLogEntry = {
		...entry,
		timestamp: new Date().toISOString()
	};

	// Format for structured logging
	const logMessage = JSON.stringify(fullEntry);

	// Log to appropriate level based on severity
	switch (entry.severity) {
		case AuditSeverity.INFO:
			console.info(`[audit] ${logMessage}`);
			break;
		case AuditSeverity.WARNING:
			console.warn(`[audit] ${logMessage}`);
			break;
		case AuditSeverity.ERROR:
			console.error(`[audit] ${logMessage}`);
			break;
		case AuditSeverity.CRITICAL:
			console.error(`[audit][CRITICAL] ${logMessage}`);
			break;
	}

	// In production, also send to external logging service:
	// await sendToCloudWatch(fullEntry);
	// await sendToDatadog(fullEntry);
	// await sendToElasticsearch(fullEntry);
}

/**
 * Helper functions for common audit events
 */
export const AuditLog = {
	/** Log successful upload */
	uploadSuccess: (userId: string, resourceId: string, metadata?: Record<string, any>) =>
		logAuditEvent({
			eventType: AuditEventType.UPLOAD_SUCCESS,
			severity: AuditSeverity.INFO,
			userId,
			resourceId,
			resourceType: 'map',
			action: 'upload',
			result: 'success',
			metadata
		}),

	/** Log failed upload */
	uploadFailure: (
		userId: string,
		errorMessage: string,
		metadata?: Record<string, any>,
		correlationId?: string
	) =>
		logAuditEvent({
			eventType: AuditEventType.UPLOAD_FAILURE,
			severity: AuditSeverity.ERROR,
			userId,
			action: 'upload',
			result: 'failure',
			errorMessage,
			metadata,
			correlationId
		}),

	/** Log rejected upload (rate limit, validation, etc.) */
	uploadRejected: (
		userId: string,
		reason: string,
		metadata?: Record<string, any>,
		correlationId?: string
	) =>
		logAuditEvent({
			eventType: AuditEventType.UPLOAD_REJECTED,
			severity: AuditSeverity.WARNING,
			userId,
			action: 'upload',
			result: 'rejected',
			errorMessage: reason,
			metadata,
			correlationId
		}),

	/** Log rate limit exceeded */
	rateLimitExceeded: (userId: string, endpoint: string, metadata?: Record<string, any>) =>
		logAuditEvent({
			eventType: AuditEventType.RATE_LIMIT_EXCEEDED,
			severity: AuditSeverity.WARNING,
			userId,
			action: `rate_limit_${endpoint}`,
			result: 'rejected',
			metadata
		}),

	/** Log download */
	downloadSuccess: (userId: string, resourceId: string, metadata?: Record<string, any>) =>
		logAuditEvent({
			eventType: AuditEventType.DOWNLOAD_SUCCESS,
			severity: AuditSeverity.INFO,
			userId,
			resourceId,
			resourceType: 'map',
			action: 'download',
			result: 'success',
			metadata
		}),

	/** Log deletion */
	deleteSuccess: (userId: string, resourceId: string, metadata?: Record<string, any>) =>
		logAuditEvent({
			eventType: AuditEventType.DELETE_SUCCESS,
			severity: AuditSeverity.INFO,
			userId,
			resourceId,
			resourceType: 'map',
			action: 'delete',
			result: 'success',
			metadata
		}),

	/** Log retry */
	retryInitiated: (userId: string, resourceId: string, metadata?: Record<string, any>) =>
		logAuditEvent({
			eventType: AuditEventType.RETRY_INITIATED,
			severity: AuditSeverity.INFO,
			userId,
			resourceId,
			resourceType: 'map',
			action: 'retry',
			result: 'success',
			metadata
		}),

	/** Log unauthorized access attempt */
	unauthorizedAccess: (
		userId: string | undefined,
		action: string,
		ipAddress?: string,
		metadata?: Record<string, any>
	) =>
		logAuditEvent({
			eventType: AuditEventType.UNAUTHORIZED_ACCESS,
			severity: AuditSeverity.WARNING,
			userId,
			action,
			result: 'rejected',
			ipAddress,
			metadata
		}),

	/** Log forbidden access (authenticated but not authorized) */
	forbiddenAccess: (
		userId: string,
		resourceId: string,
		action: string,
		metadata?: Record<string, any>
	) =>
		logAuditEvent({
			eventType: AuditEventType.FORBIDDEN_ACCESS,
			severity: AuditSeverity.WARNING,
			userId,
			resourceId,
			action,
			result: 'rejected',
			metadata
		}),

	/** Log service error */
	serviceError: (
		serviceName: string,
		errorMessage: string,
		correlationId?: string,
		metadata?: Record<string, any>
	) =>
		logAuditEvent({
			eventType: AuditEventType.SERVICE_ERROR,
			severity: AuditSeverity.ERROR,
			action: `${serviceName}_error`,
			result: 'failure',
			errorMessage,
			correlationId,
			metadata
		}),

	/** Log custom audit event */
	customEvent: (entry: Omit<AuditLogEntry, 'timestamp'>) => logAuditEvent(entry)
};
