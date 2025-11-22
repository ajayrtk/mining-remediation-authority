// Dashboard data loader - fetches recent jobs and map names

import { ScanCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { MAP_JOBS_TABLE, MAPS_TABLE, dynamoDocClient } from '$lib/server/dynamo';
import type { PageServerLoad } from './$types';

export type JobSummary = {
	jobId: string;
	mapNames: string[];
	mapStatuses?: string[]; // Array of map statuses corresponding to mapNames
	status: string;
	submittedBy: string;
	inputS3?: {
		bucket: string;
		key: string;
		url: string;
	};
	s3Output?: {
		bucket: string;
		key: string;
		url: string;
	};
	createdAt: string | null;
	notificationStatus?: string;
	sizeBytes?: number;
	batchSize?: number;
	processedCount?: number;
	totalMaps?: number;
};

const fetchRecentJobs = async (): Promise<JobSummary[]> => {
	if (!MAP_JOBS_TABLE || !MAPS_TABLE) {
		return [];
	}

	try {
		const result = await dynamoDocClient.send(
			new ScanCommand({
				TableName: MAP_JOBS_TABLE,
				Limit: 100
			})
		);

		const jobItems = (result.Items ?? []).sort((a, b) => {
			const aDate = a.createdAt ?? '';
			const bDate = b.createdAt ?? '';
			return String(bDate).localeCompare(String(aDate));
		});

		const jobsWithMaps = await Promise.all(
			jobItems.map(async (item) => {
				const jobId = String(item.jobId ?? '');

				// Query MAPS table using JobIdIndex to get all maps for this job
				let mapNames: string[] = [];
				let mapStatuses: string[] = [];
				try {
					const mapsResult = await dynamoDocClient.send(
						new QueryCommand({
							TableName: MAPS_TABLE,
							IndexName: 'JobIdIndex',
							KeyConditionExpression: 'jobId = :jobId',
							ExpressionAttributeValues: {
								':jobId': jobId
							},
							ProjectionExpression: 'mapName, #status',
							ExpressionAttributeNames: {
								'#status': 'status'
							}
						})
					);
					mapNames = (mapsResult.Items ?? []).map(m => String(m.mapName ?? ''));
					mapStatuses = (mapsResult.Items ?? []).map(m => String(m.status ?? 'UNKNOWN'));
				} catch (error) {
					console.error(`Failed to fetch maps for job ${jobId}`, error);
				}

				return {
					jobId,
					mapNames,
					mapStatuses,
					status: String(item.status ?? 'UNKNOWN'),
					submittedBy: String(item.submittedBy ?? ''),
					inputS3: item.inputS3,
					s3Output: item.s3Output,
					createdAt: item.createdAt ? String(item.createdAt) : null,
					notificationStatus: item.notificationStatus ? String(item.notificationStatus) : undefined,
					sizeBytes: item.sizeBytes ? Number(item.sizeBytes) : undefined,
					batchSize: item.batchSize ? Number(item.batchSize) : undefined,
					processedCount: item.processedCount ? Number(item.processedCount) : undefined,
					totalMaps: item.totalMaps ? Number(item.totalMaps) : undefined
				};
			})
		);

		// Clean up orphaned jobs (jobs with no associated maps but totalMaps > 0)
		const validJobs: JobSummary[] = [];
		const orphanedJobIds: string[] = [];

		for (const job of jobsWithMaps) {
			// A job is orphaned if it has maps recorded but mapNames is empty
			// This happens when all maps are deleted but cascade delete failed
			// Check totalMaps (newer jobs), batchSize (current jobs), or processedCount as fallback
			const totalMapsFromJob = job.totalMaps ?? job.batchSize ?? job.processedCount ?? 0;
			if (job.mapNames.length === 0 && totalMapsFromJob > 0) {
				orphanedJobIds.push(job.jobId);
				console.log(`Found orphaned job ${job.jobId} with ${totalMapsFromJob} total maps but 0 actual maps - will be cleaned up`);
			} else {
				validJobs.push(job);
			}
		}

		// Clean up orphaned jobs (blocks page load briefly to ensure cleanup completes)
		if (orphanedJobIds.length > 0) {
			await Promise.all(
				orphanedJobIds.map(jobId =>
					dynamoDocClient.send(
						new DeleteCommand({
							TableName: MAP_JOBS_TABLE,
							Key: { jobId }
						})
					).catch(err => console.error(`Failed to delete orphaned job ${jobId}:`, err))
				)
			);
			console.log(`Successfully deleted ${orphanedJobIds.length} orphaned job(s)`);
		}

		return validJobs;
	} catch (error) {
		console.error('Failed to fetch job history from DynamoDB', error);
		return [];
	}
};

export const load: PageServerLoad = async ({ locals }) => {
	const jobs = locals.user ? await fetchRecentJobs() : [];
	return { jobs, user: locals.user };
};
