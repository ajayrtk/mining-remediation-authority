/**
 * Server-side data loader for the main dashboard page
 * Fetches recent jobs and their associated map names
 */

import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { MAP_JOBS_TABLE, MAPS_TABLE, dynamoDocClient } from '$lib/server/dynamo';
import type { PageServerLoad } from './$types';

export type JobSummary = {
	jobId: string;
	mapNames: string[];
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

		const jobs = await Promise.all(
			jobItems.map(async (item) => {
				const jobId = String(item.jobId ?? '');

				// Query MAPS table using JobIdIndex to get all maps for this job
				let mapNames: string[] = [];
				try {
					const mapsResult = await dynamoDocClient.send(
						new QueryCommand({
							TableName: MAPS_TABLE,
							IndexName: 'JobIdIndex',
							KeyConditionExpression: 'jobId = :jobId',
							ExpressionAttributeValues: {
								':jobId': jobId
							},
							ProjectionExpression: 'mapName'
						})
					);
					mapNames = (mapsResult.Items ?? []).map(m => String(m.mapName ?? ''));
				} catch (error) {
					console.error(`Failed to fetch maps for job ${jobId}`, error);
				}

				return {
					jobId,
					mapNames,
					status: String(item.status ?? 'UNKNOWN'),
					submittedBy: String(item.submittedBy ?? ''),
					inputS3: item.inputS3,
					s3Output: item.s3Output,
					createdAt: item.createdAt ? String(item.createdAt) : null,
					notificationStatus: item.notificationStatus ? String(item.notificationStatus) : undefined,
					sizeBytes: item.sizeBytes ? Number(item.sizeBytes) : undefined,
					batchSize: item.batchSize ? Number(item.batchSize) : undefined,
					processedCount: item.processedCount ? Number(item.processedCount) : undefined
				};
			})
		);

		return jobs;
	} catch (error) {
		console.error('Failed to fetch job history from DynamoDB', error);
		return [];
	}
};

export const load: PageServerLoad = async ({ locals }) => {
	const jobs = locals.user ? await fetchRecentJobs() : [];
	return { jobs, user: locals.user };
};
