// Maps registry data loader - fetches all processed maps from DynamoDB

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { MAPS_TABLE, dynamoDocClient } from '$lib/server/dynamo';
import { s3Client, MAP_OUTPUT_BUCKET } from '$lib/server/s3';
import type { PageServerLoad } from './$types';

export type MapEntry = {
	mapId: string;
	mapName: string;
	ownerEmail: string;
	createdAt: string;
	processedAt?: string;
	inputSizeBytes?: number;  // Input file size (uploaded ZIP)
	outputSizeBytes?: number; // Output file size (processed ZIP)
	mapVersion?: number;
	jobId?: string;
	jobStatus?: string;
	s3Output?: {
		bucket: string;
		key: string;
		url: string;
	};
	// Timing metrics for performance analysis
	dispatchedAt?: string;    // When Lambda dispatched ECS task
	taskArn?: string;         // ECS task ARN
	taskStartedAt?: string;   // When ECS task started running
	taskStoppedAt?: string;   // When ECS task stopped
};

// Helper to fetch output size from S3
const getOutputSizeFromS3 = async (bucket: string, key: string): Promise<number | undefined> => {
	try {
		const response = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		return response.ContentLength;
	} catch (error) {
		console.warn(`[maps] Failed to get output size for ${key}:`, error);
		return undefined;
	}
};

const fetchMaps = async (limit: number = 50, lastKey?: any): Promise<{ maps: MapEntry[], lastEvaluatedKey?: any }> => {
	if (!MAPS_TABLE) {
		return { maps: [] };
	}

	try {
		const params: any = {
			TableName: MAPS_TABLE,
			Limit: limit
		};

		if (lastKey) {
			params.ExclusiveStartKey = lastKey;
		}

		const result = await dynamoDocClient.send(new ScanCommand(params));

		// Map the items with their individual status and timing metrics
		const mapsWithStatus = (result.Items ?? []).map((item) => {
			// Read inputSizeBytes with fallback to sizeBytes for backwards compatibility
			const inputSizeBytes = item.inputSizeBytes
				? Number(item.inputSizeBytes)
				: (item.sizeBytes ? Number(item.sizeBytes) : undefined);

			return {
				mapId: String(item.mapId ?? ''),
				mapName: String(item.mapName ?? ''),
				ownerEmail: String(item.ownerEmail ?? ''),
				createdAt: String(item.createdAt ?? ''),
				processedAt: item.processedAt ? String(item.processedAt) : undefined,
				inputSizeBytes,
				outputSizeBytes: item.outputSizeBytes ? Number(item.outputSizeBytes) : undefined,
				mapVersion: item.mapVersion ? Number(item.mapVersion) : undefined,
				jobId: item.jobId ? String(item.jobId) : undefined,
				jobStatus: item.status ? String(item.status) : undefined,
				s3Output: item.s3Output,
				// Timing metrics
				dispatchedAt: item.dispatchedAt ? String(item.dispatchedAt) : undefined,
				taskArn: item.taskArn ? String(item.taskArn) : undefined,
				taskStartedAt: item.taskStartedAt ? String(item.taskStartedAt) : undefined,
				taskStoppedAt: item.taskStoppedAt ? String(item.taskStoppedAt) : undefined
			};
		});

		// For COMPLETED maps without outputSizeBytes, fetch from S3
		const mapsWithOutputSizes = await Promise.all(
			mapsWithStatus.map(async (map) => {
				// If outputSizeBytes is already set, use it
				if (map.outputSizeBytes !== undefined) {
					return map;
				}

				// For COMPLETED maps with s3Output, fetch size from S3
				if (map.jobStatus === 'COMPLETED' && map.s3Output?.bucket && map.s3Output?.key) {
					const outputSize = await getOutputSizeFromS3(map.s3Output.bucket, map.s3Output.key);
					return { ...map, outputSizeBytes: outputSize };
				}

				return map;
			})
		);

		return {
			maps: mapsWithOutputSizes,
			lastEvaluatedKey: result.LastEvaluatedKey
		};
	} catch (error) {
		console.error('[maps] Failed to fetch maps from DynamoDB:', error);
		return { maps: [] };
	}
};

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		return { maps: [], totalCount: 0, lastEvaluatedKey: null };
	}

	const limit = Number(url.searchParams.get('limit') || '50');
	const lastKeyParam = url.searchParams.get('lastKey');
	const lastKey = lastKeyParam ? JSON.parse(decodeURIComponent(lastKeyParam)) : undefined;

	const { maps, lastEvaluatedKey } = await fetchMaps(limit, lastKey);

	return {
		maps,
		lastEvaluatedKey: lastEvaluatedKey || null,
		user: locals.user
	};
};
