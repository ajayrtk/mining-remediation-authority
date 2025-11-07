# ECS Map Processor
# This runs as a Fargate task for each uploaded file
# Main jobs:
# 1. Copy ZIP file from input bucket to output bucket
# 2. Update DynamoDB with processing status (COMPLETED or FAILED)
# 3. Track job completion - all maps in batch done?
# 4. Handle failures with error messages for retry logic

import logging
import os
import sys
from datetime import datetime
import boto3
from botocore.exceptions import ClientError

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# AWS clients
s3_client = boto3.client('s3')
dynamo_client = boto3.client('dynamodb')

# Environment variables passed from ECS task definition
INPUT_BUCKET = os.getenv('INPUT_BUCKET')
OUTPUT_BUCKET = os.getenv('OUTPUT_BUCKET')
INPUT_KEY = os.getenv('INPUT_KEY')  # Path to the file in S3
MAP_NAME = os.getenv('MAP_NAME')  # Map filename (sanitized)
JOB_ID = os.getenv('JOB_ID')  # Batch job ID
MAP_ID = os.getenv('MAP_ID')  # Unique map identifier (hash-based)
JOBS_TABLE = os.getenv('JOBS_TABLE_NAME')
MAPS_TABLE = os.getenv('MAPS_TABLE_NAME')


def iso_timestamp():
    """Generate current timestamp in ISO 8601 format"""
    return datetime.utcnow().isoformat(timespec='milliseconds') + 'Z'


def update_job_status(job_id, status):
    """Update job status in DynamoDB"""
    if not job_id or not JOBS_TABLE:
        logger.warning(f"Cannot update job status: job_id={job_id}, JOBS_TABLE={JOBS_TABLE}")
        return

    try:
        dynamo_client.update_item(
            TableName=JOBS_TABLE,
            Key={'jobId': {'S': job_id}},
            UpdateExpression='SET #status = :status, updatedAt = :updated',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': {'S': status},
                ':updated': {'S': iso_timestamp()}
            }
        )
        logger.info(f"Updated job {job_id} status to {status}")
    except ClientError as e:
        logger.error(f"Failed to update job status: {e}")
        raise


def increment_processed_count(job_id):
    """
    Increment the processed count for successful files
    Also checks if the entire batch is done (processed + failed = batch size)
    Uses atomic DynamoDB updates to prevent race conditions when multiple
    ECS tasks are running in parallel
    """
    if not job_id or not JOBS_TABLE:
        return

    try:
        # Atomic increment - safe for concurrent updates
        response = dynamo_client.update_item(
            TableName=JOBS_TABLE,
            Key={'jobId': {'S': job_id}},
            UpdateExpression='SET processedCount = processedCount + :inc, updatedAt = :updated',
            ExpressionAttributeValues={
                ':inc': {'N': '1'},
                ':updated': {'S': iso_timestamp()}
            },
            ReturnValues='ALL_NEW'
        )

        # Get the updated counts
        attrs = response.get('Attributes', {})
        processed = int(attrs.get('processedCount', {}).get('N', '0'))
        failed = int(attrs.get('failedCount', {}).get('N', '0'))
        batch_size = int(attrs.get('batchSize', {}).get('N', '1'))

        total_completed = processed + failed
        logger.info(f"Job {job_id}: {processed} succeeded, {failed} failed, {total_completed}/{batch_size} total")

        # Check if we're done with the entire batch
        # Total completed = successful + failed (all files accounted for)
        if total_completed >= batch_size:
            # Determine final status based on the mix of success/failure
            if failed == 0:
                final_status = 'COMPLETED'  # Everything succeeded
                logger.info(f"All {batch_size} maps succeeded for job {job_id}")
            elif processed == 0:
                final_status = 'FAILED'  # Everything failed
                logger.info(f"All {batch_size} maps failed for job {job_id}")
            else:
                final_status = 'PARTIAL_SUCCESS'  # Mixed results
                logger.info(f"Job {job_id} completed with {processed} successes and {failed} failures")

            update_job_status(job_id, final_status)
            return True

        return False
    except ClientError as e:
        logger.error(f"Failed to increment processed count: {e}")
        raise


def increment_failed_count(job_id):
    """
    Increment the failed count when a file fails processing
    This is used for retry logic - failed maps can be retried later
    Also checks if the batch is complete (similar to increment_processed_count)
    """
    if not job_id or not JOBS_TABLE:
        return

    try:
        # Atomic increment with initialization
        # if_not_exists handles the case where failedCount doesn't exist yet
        response = dynamo_client.update_item(
            TableName=JOBS_TABLE,
            Key={'jobId': {'S': job_id}},
            UpdateExpression='SET failedCount = if_not_exists(failedCount, :zero) + :inc, updatedAt = :updated',
            ExpressionAttributeValues={
                ':inc': {'N': '1'},
                ':zero': {'N': '0'},  # Start at 0 if field doesn't exist
                ':updated': {'S': iso_timestamp()}
            },
            ReturnValues='ALL_NEW'
        )

        # Get current counts to check if batch is complete
        attrs = response.get('Attributes', {})
        processed = int(attrs.get('processedCount', {}).get('N', '0'))
        failed = int(attrs.get('failedCount', {}).get('N', '0'))
        batch_size = int(attrs.get('batchSize', {}).get('N', '1'))

        total_completed = processed + failed
        logger.info(f"Job {job_id}: {processed} succeeded, {failed} failed, {total_completed}/{batch_size} total")

        # Check if all files have been processed (success or failure)
        if total_completed >= batch_size:
            # Determine the overall job status
            if failed == batch_size:
                final_status = 'FAILED'  # All files failed
                logger.info(f"All {batch_size} maps failed for job {job_id}")
            elif processed == batch_size:
                final_status = 'COMPLETED'  # All files succeeded
                logger.info(f"All {batch_size} maps succeeded for job {job_id}")
            else:
                final_status = 'PARTIAL_SUCCESS'  # Some failed, some succeeded
                logger.info(f"Job {job_id} completed with {processed} successes and {failed} failures")

            update_job_status(job_id, final_status)
            return True

        return False
    except ClientError as e:
        logger.error(f"Failed to increment failed count: {e}")
        raise


def update_map_output(map_id, map_name, output_bucket, output_key):
    """
    Update MAP entry with output S3 location and mark as COMPLETED
    This records where the processed file ended up so users can download it later
    Raises ValueError if required parameters are missing
    """
    if not map_id or not map_name or not MAPS_TABLE:
        error_msg = f"Cannot update map output - missing required parameters: map_id={map_id}, map_name={map_name}, MAPS_TABLE={MAPS_TABLE}"
        logger.error(error_msg)
        raise ValueError(error_msg)

    try:
        timestamp = iso_timestamp()
        # Store the output location in DynamoDB as a map object with bucket, key, and full URL
        response = dynamo_client.update_item(
            TableName=MAPS_TABLE,
            Key={
                'mapId': {'S': map_id},
                'mapName': {'S': map_name}
            },
            UpdateExpression='SET s3Output = :s3_output, updatedAt = :updated, processedAt = :processed, #status = :status',
            ExpressionAttributeNames={
                '#status': 'status'  # 'status' is reserved in DynamoDB
            },
            ExpressionAttributeValues={
                ':s3_output': {
                    'M': {
                        'bucket': {'S': output_bucket},
                        'key': {'S': output_key},
                        'url': {'S': f'https://s3.amazonaws.com/{output_bucket}/{output_key}'}
                    }
                },
                ':updated': {'S': timestamp},
                ':processed': {'S': timestamp},
                ':status': {'S': 'COMPLETED'}
            },
            ReturnValues='ALL_NEW'
        )

        # Verify the update was successful
        if not response.get('Attributes'):
            error_msg = f"Map update returned no attributes - map may not exist: {map_id}/{map_name}"
            logger.error(error_msg)
            raise ValueError(error_msg)

        logger.info(f"Successfully updated map {map_id}/{map_name} with output location and status COMPLETED")
    except ClientError as e:
        logger.error(f"DynamoDB error updating map output: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error updating map output: {e}")
        raise


def mark_map_failed(map_id, map_name, error_message):
    """
    Mark a map as FAILED in DynamoDB with error details
    This is critical for retry logic - when a user re-uploads the same file,
    we check the status and allow retry if it's FAILED
    Raises ValueError if required parameters are missing
    """
    if not map_id or not map_name or not MAPS_TABLE:
        error_msg = f"Cannot mark map as failed - missing required parameters: map_id={map_id}, map_name={map_name}, MAPS_TABLE={MAPS_TABLE}"
        logger.error(error_msg)
        raise ValueError(error_msg)

    try:
        timestamp = iso_timestamp()
        # Truncate error message to avoid DynamoDB item size limits (400KB total)
        # Keeping it to 1000 chars is safe
        truncated_error = error_message[:1000] if error_message else "Unknown error"

        response = dynamo_client.update_item(
            TableName=MAPS_TABLE,
            Key={
                'mapId': {'S': map_id},
                'mapName': {'S': map_name}
            },
            UpdateExpression='SET #status = :status, errorMessage = :error, updatedAt = :updated, lastProcessedAt = :processed',
            ExpressionAttributeNames={
                '#status': 'status'  # 'status' is a reserved word in DynamoDB
            },
            ExpressionAttributeValues={
                ':status': {'S': 'FAILED'},
                ':error': {'S': truncated_error},
                ':updated': {'S': timestamp},
                ':processed': {'S': timestamp}
            },
            ReturnValues='ALL_NEW'
        )

        # Verify the update was successful
        if not response.get('Attributes'):
            error_msg = f"Failed to mark map as FAILED - map may not exist: {map_id}/{map_name}"
            logger.error(error_msg)
            raise ValueError(error_msg)

        logger.info(f"Successfully marked map {map_id}/{map_name} as FAILED with error: {truncated_error}")
    except ClientError as e:
        logger.error(f"DynamoDB error marking map as failed: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error marking map as failed: {e}")
        raise


def process_file(input_bucket, input_key, output_bucket, output_key):
    """
    Copy file from input bucket to output bucket
    Right now this is simple - just copy the ZIP file as-is
    In the future, we could add actual processing here (unzip, validate, etc.)
    """
    logger.info(f"Reading file: {input_bucket}/{input_key}")

    try:
        # Use S3's server-side copy - faster than downloading and re-uploading
        # This copies the file directly within AWS without downloading it to the container
        s3_client.copy_object(
            CopySource={"Bucket": input_bucket, "Key": input_key},
            Bucket=output_bucket,
            Key=output_key,
            MetadataDirective="COPY",  # Keep original metadata
            TaggingDirective="COPY"     # Keep original tags
        )
        logger.info(f"Successfully copied to {output_bucket}/{output_key}")
        return True
    except ClientError as e:
        logger.error(f"Failed to copy file: {e}")
        raise


def main():
    """Main entry point - this is what runs when the ECS task starts"""
    logger.info("ECS Map Processor started")
    logger.info(f"Job ID: {JOB_ID}")
    logger.info(f"Map ID: {MAP_ID}")
    logger.info(f"Input: {INPUT_BUCKET}/{INPUT_KEY}")
    logger.info(f"Output: {OUTPUT_BUCKET}")

    # First, make sure we have all the required environment variables
    # If anything is missing, we can't proceed
    required_vars = {
        'INPUT_BUCKET': INPUT_BUCKET,
        'OUTPUT_BUCKET': OUTPUT_BUCKET,
        'INPUT_KEY': INPUT_KEY,
        'MAP_NAME': MAP_NAME,
        'JOB_ID': JOB_ID,
        'MAP_ID': MAP_ID,
        'JOBS_TABLE_NAME': JOBS_TABLE,
        'MAPS_TABLE_NAME': MAPS_TABLE
    }

    missing = [k for k, v in required_vars.items() if not v]
    if missing:
        logger.error(f"Missing required environment variables: {missing}")
        # Try to mark job as failed if we have enough info
        if JOB_ID and JOBS_TABLE:
            try:
                update_job_status(JOB_ID, 'FAILED')
            except:
                pass  # If this fails too, nothing we can do
        sys.exit(1)

    try:
        # Step 1: Update job status to show we're actively processing
        logger.info(f"Updating job {JOB_ID} to PROCESSING")
        update_job_status(JOB_ID, 'PROCESSING')

        # Step 2: Figure out the output path
        # Use MAP_NAME from environment variable (passed from input_handler)
        # This ensures consistency with what was stored in DynamoDB
        output_key = f"output/{MAP_NAME}"

        # Step 3: Do the actual file processing (currently just copying)
        logger.info(f"Processing file: {MAP_NAME}")
        process_file(INPUT_BUCKET, INPUT_KEY, OUTPUT_BUCKET, output_key)

        # Step 4: Record where the output file ended up
        logger.info(f"Updating map {MAP_ID}/{MAP_NAME} with output location")
        update_map_output(MAP_ID, MAP_NAME, OUTPUT_BUCKET, output_key)

        # Step 5: Increment the success counter
        # This function also checks if all files in the batch are done
        logger.info(f"Incrementing processed count for job {JOB_ID}")
        increment_processed_count(JOB_ID)

        logger.info("File processing completed successfully")
        sys.exit(0)

    except Exception as e:
        # Something went wrong - log the error and update tracking tables
        logger.error(f"Processing failed: {e}", exc_info=True)
        error_message = str(e)

        # Try to mark the individual map as failed so user can retry it
        if MAP_ID and MAP_NAME and MAPS_TABLE:
            try:
                logger.info(f"Marking map {MAP_ID}/{MAP_NAME} as FAILED")
                mark_map_failed(MAP_ID, MAP_NAME, error_message)
            except Exception as map_error:
                logger.error(f"Failed to mark map as FAILED: {map_error}")

        # Increment the failure counter for the overall job
        if JOB_ID and JOBS_TABLE:
            try:
                logger.info(f"Incrementing failed count for job {JOB_ID}")
                increment_failed_count(JOB_ID)
            except Exception as count_error:
                logger.error(f"Failed to increment failed count: {count_error}")

        sys.exit(1)


if __name__ == "__main__":
    main()
