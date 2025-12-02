// Audit logging for security-relevant operations

export enum AuditEventType {
	// Delete events
	DELETE_SUCCESS = 'DELETE_SUCCESS',

	// Security events
	UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
	FORBIDDEN_ACCESS = 'FORBIDDEN_ACCESS'
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

}

export const AuditLog = {
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

	customEvent: (entry: Omit<AuditLogEntry, 'timestamp'>) => logAuditEvent(entry)
};
