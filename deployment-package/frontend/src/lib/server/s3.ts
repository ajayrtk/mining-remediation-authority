import { S3Client } from '@aws-sdk/client-s3';
import { env } from '$env/dynamic/private';

export const MAP_INPUT_BUCKET = env.MAP_INPUT_BUCKET ?? 'map-input';
export const MAP_OUTPUT_BUCKET = env.MAP_OUTPUT_BUCKET ?? 'map-output';

// Create client lazily to ensure env vars are loaded
let _s3Client: S3Client | null = null;

function getClient() {
	if (!_s3Client) {
		const region = env.AWS_REGION ?? 'eu-west-2';
		const accessKeyId = env.AWS_ACCESS_KEY_ID;
		const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

		_s3Client = new S3Client({
			region,
			credentials: accessKeyId && secretAccessKey
				? {
						accessKeyId,
						secretAccessKey
				  }
				: undefined
		});
	}
	return _s3Client;
}

export const s3Client = {
	send: (command: any) => getClient().send(command)
};

// Export actual client instance for getSignedUrl
export const getS3Client = () => getClient();
