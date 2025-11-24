import json
import logging
import os
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client("s3")
dynamo = boto3.client("dynamodb")

TABLE_NAME = os.getenv("JOBS_TABLE_NAME")
MAPS_TABLE_NAME = os.getenv("MAPS_TABLE_NAME")
OUTPUT_BUCKET = os.getenv("OUTPUT_BUCKET")
PROJECT = os.getenv("PROJECT_NAME", "mra-mines")

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def iso_timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


def increment_processed_count(job_id: str) -> dict:
    """Increment processedCount and return updated job info"""
    if not TABLE_NAME or not job_id:
        return {}

    try:
        response = dynamo.update_item(
            TableName=TABLE_NAME,
            Key={"jobId": {"S": job_id}},
            UpdateExpression="SET processedCount = if_not_exists(processedCount, :zero) + :inc, updatedAt = :updated",
            ExpressionAttributeValues={
                ":inc": {"N": "1"},
                ":zero": {"N": "0"},
                ":updated": {"S": iso_timestamp()}
            },
            ReturnValues="ALL_NEW"
        )

        attrs = response.get("Attributes", {})
        processed = int(attrs.get("processedCount", {}).get("N", "0"))
        batch_size = int(attrs.get("batchSize", {}).get("N", "0"))

        logger.info(f"Job {job_id}: processed {processed}/{batch_size} maps")

        # Check if all maps are processed (only if batchSize is known)
        if batch_size > 0 and processed >= batch_size:
            logger.info(f"All maps processed for job {job_id}, marking as COMPLETED")
            dynamo.update_item(
                TableName=TABLE_NAME,
                Key={"jobId": {"S": job_id}},
                UpdateExpression="SET #status = :status, updatedAt = :updated",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":status": {"S": "COMPLETED"},
                    ":updated": {"S": iso_timestamp()}
                }
            )

        return {"processed": processed, "batchSize": batch_size}
    except ClientError as e:
        logger.error(f"Failed to increment processed count: {e}")
        return {}


def update_map_output(map_id: str, map_name: str, output_bucket: str, output_key: str) -> None:
    """Update MAP entry with output S3 location and mark as COMPLETED."""
    if not MAPS_TABLE_NAME:
        logger.warning("MAPS_TABLE_NAME not configured, skipping MAP update")
        return

    try:
        dynamo.update_item(
            TableName=MAPS_TABLE_NAME,
            Key={
                "mapId": {"S": map_id},
                "mapName": {"S": map_name}
            },
            UpdateExpression="SET s3Output = :s3_output, #status = :status, processedAt = :processed, updatedAt = :updated",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":s3_output": {
                    "M": {
                        "bucket": {"S": output_bucket},
                        "key": {"S": output_key},
                        "url": {"S": f"https://s3.amazonaws.com/{output_bucket}/{output_key}"}
                    }
                },
                ":status": {"S": "COMPLETED"},
                ":processed": {"S": iso_timestamp()},
                ":updated": {"S": iso_timestamp()}
            }
        )
        logger.info(f"Updated MAP entry with output and marked COMPLETED: {map_id} / {map_name}")
    except ClientError as exc:
        logger.exception("Failed to update MAP entry with output", extra={
            "mapId": map_id,
            "mapName": map_name,
            "error": str(exc)
        })


def validate_event(event: dict) -> tuple[str, str, str, str]:
    """
    Validate and extract required fields from Lambda event.

    Returns: (job_id, map_id, source_bucket, source_key)
    Raises: ValueError if validation fails
    """
    if not isinstance(event, dict):
        raise ValueError(f"Event must be a dict, got {type(event).__name__}")

    # Check required fields exist
    required_fields = ["jobId", "mapId", "bucket", "key"]
    missing = [f for f in required_fields if f not in event]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")

    # Extract and validate each field
    job_id = event.get("jobId")
    map_id = event.get("mapId")
    source_bucket = event.get("bucket")
    source_key = event.get("key")

    # Ensure fields are non-empty strings
    if not isinstance(job_id, str) or not job_id.strip():
        raise ValueError("jobId must be a non-empty string")
    if not isinstance(map_id, str) or not map_id.strip():
        raise ValueError("mapId must be a non-empty string")
    if not isinstance(source_bucket, str) or not source_bucket.strip():
        raise ValueError("bucket must be a non-empty string")
    if not isinstance(source_key, str) or not source_key.strip():
        raise ValueError("key must be a non-empty string")

    return job_id.strip(), map_id.strip(), source_bucket.strip(), source_key.strip()


def lambda_handler(event, _context):
    """
    Copy ZIP file from input bucket to output bucket.
    Triggered by the input handler after DynamoDB entry is created.

    Expected event structure:
    {
        "jobId": "uuid",
        "mapId": "map_xxx",
        "bucket": "source-bucket-name",
        "key": "source/object/key.zip",
        "project": "project-name"
    }
    """
    if not TABLE_NAME or not OUTPUT_BUCKET:
        raise RuntimeError("Missing JOBS_TABLE_NAME or OUTPUT_BUCKET environment variables")

    # Validate event structure and extract fields
    try:
        job_id, map_id, source_bucket, source_key = validate_event(event)
    except ValueError as e:
        logger.error(f"Event validation failed: {e}", extra={"event": event})
        return {
            "statusCode": 400,
            "body": json.dumps({
                "status": "FAILED",
                "error": f"Invalid event structure: {str(e)}"
            })
        }

    # Extract map name from source key (filename)
    map_name = source_key.split('/')[-1] if '/' in source_key else source_key

    logger.info(f"Processing S3 copy for job {job_id}, map {map_id}/{map_name}: {source_bucket}/{source_key}")

    try:
        # Update job status to PROCESSING
        dynamo.update_item(
            TableName=TABLE_NAME,
            Key={"jobId": {"S": job_id}},
            UpdateExpression="SET #status = :status",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": {"S": "PROCESSING"}
            },
        )

        # Update THIS specific map's status to PROCESSING
        if MAPS_TABLE_NAME:
            dynamo.update_item(
                TableName=MAPS_TABLE_NAME,
                Key={
                    "mapId": {"S": map_id},
                    "mapName": {"S": map_name}
                },
                UpdateExpression="SET #status = :status, updatedAt = :updated",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":status": {"S": "PROCESSING"},
                    ":updated": {"S": iso_timestamp()}
                }
            )
            logger.info(f"Updated map {map_id}/{map_name} status to PROCESSING")

        # Generate output key - add "-output" before extension
        # Example: myfile.zip -> myfile-output.zip
        if source_key.endswith('.zip'):
            output_key = source_key[:-4] + '-output.zip'
        else:
            output_key = source_key + '-output'

        # Copy object from input bucket to output bucket
        copy_source = {"Bucket": source_bucket, "Key": source_key}

        s3_client.copy_object(
            CopySource=copy_source,
            Bucket=OUTPUT_BUCKET,
            Key=output_key,
            MetadataDirective="COPY",
            TaggingDirective="COPY"
        )

        logger.info(f"Successfully copied {source_key} to {OUTPUT_BUCKET}/{output_key}")

        # Update MAPS table with output location
        update_map_output(map_id, map_name, OUTPUT_BUCKET, output_key)

        # Increment processed count (will auto-complete job if all maps done)
        increment_processed_count(job_id)

        return {
            "statusCode": 200,
            "body": json.dumps({
                "jobId": job_id,
                "status": "COMPLETED",
                "outputBucket": OUTPUT_BUCKET,
                "outputKey": output_key
            })
        }

    except ClientError as exc:
        error_message = exc.response.get("Error", {}).get("Message", str(exc))
        logger.exception(f"Failed to copy S3 object for job {job_id}", extra={
            "job_id": job_id,
            "source_bucket": source_bucket,
            "source_key": source_key,
            "error": error_message
        })

        # Update DynamoDB to mark job as FAILED
        try:
            dynamo.update_item(
                TableName=TABLE_NAME,
                Key={"jobId": {"S": job_id}},
                UpdateExpression="SET #status = :failed",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":failed": {"S": "FAILED"}
                },
            )

            # Update THIS specific map's status to FAILED
            if MAPS_TABLE_NAME:
                dynamo.update_item(
                    TableName=MAPS_TABLE_NAME,
                    Key={
                        "mapId": {"S": map_id},
                        "mapName": {"S": map_name}
                    },
                    UpdateExpression="SET #status = :status, updatedAt = :updated, errorMessage = :error",
                    ExpressionAttributeNames={"#status": "status"},
                    ExpressionAttributeValues={
                        ":status": {"S": "FAILED"},
                        ":updated": {"S": iso_timestamp()},
                        ":error": {"S": error_message[:500]}
                    }
                )
                logger.info(f"Updated map {map_id}/{map_name} status to FAILED")
        except ClientError:
            logger.exception("Failed to update DynamoDB with failure status")

        return {
            "statusCode": 500,
            "body": json.dumps({
                "jobId": job_id,
                "status": "FAILED",
                "error": error_message
            })
        }

    except Exception as exc:
        error_message = str(exc)
        logger.exception(f"Unexpected error processing job {job_id}")

        try:
            dynamo.update_item(
                TableName=TABLE_NAME,
                Key={"jobId": {"S": job_id}},
                UpdateExpression="SET #status = :failed",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":failed": {"S": "FAILED"}
                },
            )

            # Update THIS specific map's status to FAILED
            if MAPS_TABLE_NAME:
                dynamo.update_item(
                    TableName=MAPS_TABLE_NAME,
                    Key={
                        "mapId": {"S": map_id},
                        "mapName": {"S": map_name}
                    },
                    UpdateExpression="SET #status = :status, updatedAt = :updated, errorMessage = :error",
                    ExpressionAttributeNames={"#status": "status"},
                    ExpressionAttributeValues={
                        ":status": {"S": "FAILED"},
                        ":updated": {"S": iso_timestamp()},
                        ":error": {"S": error_message[:500]}
                    }
                )
                logger.info(f"Updated map {map_id}/{map_name} status to FAILED")
        except ClientError:
            logger.exception("Failed to update DynamoDB with failure status")

        return {
            "statusCode": 500,
            "body": json.dumps({
                "jobId": job_id,
                "status": "FAILED",
                "error": error_message
            })
        }
