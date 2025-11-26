// DynamoDB batch write utilities

import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDocClient } from './dynamo';

interface BatchWriteItem {
	tableName: string;
	item: Record<string, any>;
}

export async function batchWriteItems(
	items: BatchWriteItem[],
	maxRetries = 3
): Promise<{ successful: number; failed: number }> {
	if (items.length === 0) {
		return { successful: 0, failed: 0 };
	}

	// DynamoDB BatchWriteItem has a limit of 25 items per request
	const BATCH_SIZE = 25;
	let successful = 0;
	let failed = 0;

	// Split into batches of 25
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);

		// Group items by table name (required format for BatchWriteCommand)
		const requestItems: Record<string, any[]> = {};
		for (const { tableName, item } of batch) {
			if (!requestItems[tableName]) {
				requestItems[tableName] = [];
			}
			requestItems[tableName].push({
				PutRequest: {
					Item: item
				}
			});
		}

		// Attempt write with retries for unprocessed items
		let unprocessedItems = requestItems;
		let retryCount = 0;

		while (Object.keys(unprocessedItems).length > 0 && retryCount <= maxRetries) {
			try {
				const result = await dynamoDocClient.send(
					new BatchWriteCommand({
						RequestItems: unprocessedItems
					})
				);

				// Count successful writes
				const itemsInBatch = Object.values(unprocessedItems).reduce(
					(sum, tableItems) => sum + tableItems.length,
					0
				);

				const unprocessedCount = result.UnprocessedItems
					? Object.values(result.UnprocessedItems).reduce(
							(sum, tableItems) => sum + (tableItems?.length || 0),
							0
					  )
					: 0;

				successful += itemsInBatch - unprocessedCount;

				// Check for unprocessed items
				if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
					unprocessedItems = result.UnprocessedItems;
					retryCount++;

					// Exponential backoff before retry
					const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 5000);
					console.warn(
						`[dynamo-batch] ${unprocessedCount} unprocessed items, retrying in ${backoffMs}ms (attempt ${retryCount}/${maxRetries})`
					);
					await new Promise((resolve) => setTimeout(resolve, backoffMs));
				} else {
					// All items processed successfully
					break;
				}
			} catch (error) {
				console.error(`[dynamo-batch] Batch write failed on attempt ${retryCount + 1}`, error);
				retryCount++;

				if (retryCount > maxRetries) {
					// Count remaining items as failed
					const remainingCount = Object.values(unprocessedItems).reduce(
						(sum, tableItems) => sum + tableItems.length,
						0
					);
					failed += remainingCount;
					console.error(
						`[dynamo-batch] Failed to write ${remainingCount} items after ${maxRetries} retries`
					);
					break;
				}

				// Exponential backoff
				const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 5000);
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
			}
		}
	}

	return { successful, failed };
}

export async function batchDeleteItems(
	items: Array<{ tableName: string; key: Record<string, any> }>,
	maxRetries = 3
): Promise<{ successful: number; failed: number }> {
	if (items.length === 0) {
		return { successful: 0, failed: 0 };
	}

	// DynamoDB BatchWriteItem has a limit of 25 items per request
	const BATCH_SIZE = 25;
	let successful = 0;
	let failed = 0;

	// Split into batches of 25
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);

		// Group items by table name (required format for BatchWriteCommand)
		const requestItems: Record<string, any[]> = {};
		for (const { tableName, key } of batch) {
			if (!requestItems[tableName]) {
				requestItems[tableName] = [];
			}
			requestItems[tableName].push({
				DeleteRequest: {
					Key: key
				}
			});
		}

		// Attempt delete with retries for unprocessed items
		let unprocessedItems = requestItems;
		let retryCount = 0;

		while (Object.keys(unprocessedItems).length > 0 && retryCount <= maxRetries) {
			try {
				const result = await dynamoDocClient.send(
					new BatchWriteCommand({
						RequestItems: unprocessedItems
					})
				);

				// Count successful deletes
				const itemsInBatch = Object.values(unprocessedItems).reduce(
					(sum, tableItems) => sum + tableItems.length,
					0
				);

				const unprocessedCount = result.UnprocessedItems
					? Object.values(result.UnprocessedItems).reduce(
							(sum, tableItems) => sum + (tableItems?.length || 0),
							0
					  )
					: 0;

				successful += itemsInBatch - unprocessedCount;

				// Check for unprocessed items
				if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
					unprocessedItems = result.UnprocessedItems;
					retryCount++;

					// Exponential backoff before retry
					const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 5000);
					console.warn(
						`[dynamo-batch] ${unprocessedCount} unprocessed delete items, retrying in ${backoffMs}ms (attempt ${retryCount}/${maxRetries})`
					);
					await new Promise((resolve) => setTimeout(resolve, backoffMs));
				} else {
					// All items processed successfully
					break;
				}
			} catch (error) {
				console.error(`[dynamo-batch] Batch delete failed on attempt ${retryCount + 1}`, error);
				retryCount++;

				if (retryCount > maxRetries) {
					// Count remaining items as failed
					const remainingCount = Object.values(unprocessedItems).reduce(
						(sum, tableItems) => sum + tableItems.length,
						0
					);
					failed += remainingCount;
					console.error(
						`[dynamo-batch] Failed to delete ${remainingCount} items after ${maxRetries} retries`
					);
					break;
				}

				// Exponential backoff
				const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 5000);
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
			}
		}
	}

	return { successful, failed };
}

export async function batchUpdateMapStatus(
	tableName: string,
	updates: Array<{
		mapId: string;
		mapName: string;
		status: string;
		updatedAt: string;
		errorMessage?: string;
	}>
): Promise<{ successful: number; failed: number }> {
	const items = updates.map((update) => ({
		tableName,
		item: {
			mapId: update.mapId,
			mapName: update.mapName,
			status: update.status,
			updatedAt: update.updatedAt,
			...(update.errorMessage && { errorMessage: update.errorMessage })
		}
	}));

	return batchWriteItems(items);
}
