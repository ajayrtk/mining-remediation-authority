// Maps registry data loader - fetches all processed maps from DynamoDB

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { MAPS_TABLE, dynamoDocClient } from '$lib/server/dynamo';
import type { PageServerLoad } from './$types';

export type MapEntry = {
	mapId: string;
	mapName: string;
	ownerEmail: string;
	createdAt: string;
	processedAt?: string;
	sizeBytes?: number;
	mapVersion?: number;
	jobId?: string;
	jobStatus?: string;
	s3Output?: {
		bucket: string;
		key: string;
		url: string;
	};
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

		// Map the items with their individual status
		const mapsWithStatus = (result.Items ?? []).map((item) => {
			return {
				mapId: String(item.mapId ?? ''),
				mapName: String(item.mapName ?? ''),
				ownerEmail: String(item.ownerEmail ?? ''),
				createdAt: String(item.createdAt ?? ''),
				processedAt: item.processedAt ? String(item.processedAt) : undefined,
				sizeBytes: item.sizeBytes ? Number(item.sizeBytes) : undefined,
				mapVersion: item.mapVersion ? Number(item.mapVersion) : undefined,
				jobId: item.jobId ? String(item.jobId) : undefined,
				jobStatus: item.status ? String(item.status) : undefined,
				s3Output: item.s3Output
			};
		});

		return {
			maps: mapsWithStatus,
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
