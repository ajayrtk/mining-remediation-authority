import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { env } from '$env/dynamic/private';
import { dynamoCircuitBreaker } from './circuit-breaker';

export const MAP_JOBS_TABLE = env.MAP_JOBS_TABLE ?? 'map-jobs';
export const MAPS_TABLE = env.MAPS_TABLE ?? 'maps';
export const WEBHOOKS_TABLE = env.WEBHOOKS_TABLE ?? 'mra-mines-webhooks';

// Create client lazily to ensure env vars are loaded
let _dynamoDocClient: DynamoDBDocumentClient | null = null;

function getClient() {
	if (!_dynamoDocClient) {
		const region = env.AWS_REGION ?? 'eu-west-2';
		const accessKeyId = env.AWS_ACCESS_KEY_ID;
		const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

		const baseClient = new DynamoDBClient({
			region,
			credentials: accessKeyId && secretAccessKey
				? {
						accessKeyId,
						secretAccessKey
				  }
				: undefined
		});

		_dynamoDocClient = DynamoDBDocumentClient.from(baseClient, {
			marshallOptions: {
				removeUndefinedValues: true
			}
		});
	}
	return _dynamoDocClient;
}

export const dynamoDocClient = {
	send: (command: any) => dynamoCircuitBreaker.execute(() => getClient().send(command))
};
