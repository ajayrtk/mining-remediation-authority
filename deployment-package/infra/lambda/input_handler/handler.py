# Lambda Input Handler
# This Lambda is triggered when a file is uploaded to the S3 input bucket
# Main responsibilities:
# 1. Extract metadata from the uploaded file (jobId, mapId, submittedBy, etc.)
# 2. Create or update job tracking records in DynamoDB
# 3. Create map entry for the uploaded file
# 4. Launch ECS Fargate task to process the file
# 5. Handle failures and retry scenarios

import json
import logging
import os
import urllib.parse
from datetime import datetime
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError

# AWS service clients
dynamo = boto3.client("dynamodb")
lambda_client = boto3.client("lambda")
s3_client = boto3.client("s3")
ecs_client = boto3.client("ecs")

# Configuration from environment variables
# These are set by Terraform when deploying the Lambda
TABLE_NAME = os.getenv("JOBS_TABLE_NAME")  # DynamoDB table for tracking jobs
MAPS_TABLE_NAME = os.getenv("MAPS_TABLE_NAME")  # DynamoDB table for individual maps
S3_COPY_FUNCTION = os.getenv("S3_COPY_FUNCTION_NAME")  # Fallback Lambda processor
ECS_CLUSTER = os.getenv("ECS_CLUSTER")  # ECS cluster name
ECS_TASK_DEFINITION = os.getenv("ECS_TASK_DEFINITION")  # Task definition for processing
ECS_SUBNETS = os.getenv("ECS_SUBNETS", "").split(",")  # VPC subnets for ECS tasks
ECS_SECURITY_GROUP = os.getenv("ECS_SECURITY_GROUP")  # Security group for ECS tasks
PROJECT = os.getenv("PROJECT_NAME", "mra-mines")  # Project name for tagging


# Helper function to generate ISO 8601 timestamps for DynamoDB
def iso_timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


# Truncate strings to avoid DynamoDB size limits
def truncate(value: str, limit: int = 500) -> str:
    return value[:limit] if value else ""


def validate_filename(filename: str) -> tuple[bool, str, str, str]:
    """
    Validate map filename format - Lambda-level enforcement
    Catches files that bypass frontend validation (e.g., direct S3 uploads)

    Format: SeamID_SheetNumber[_optional_suffix].zip
    - SeamID: MANDATORY, non-empty alphanumeric (before first underscore)
    - Underscore: MANDATORY separator
    - SheetNumber: MANDATORY, exactly 6 digits in format XXXXXX or XX_XXXX

    Returns: (is_valid, seam_id, sheet_number, error_message)
    """
    import re

    # Remove file extension
    name_without_ext = re.sub(r'\.(zip|jpg|jpeg|tif|tiff)$', '', filename, flags=re.IGNORECASE)

    # Check for mandatory underscore
    if '_' not in name_without_ext:
        return False, '', '', f"Missing mandatory underscore separator. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')"

    # Split at first underscore only
    first_underscore_idx = name_without_ext.index('_')
    seam_id = name_without_ext[:first_underscore_idx]
    after_seam_id = name_without_ext[first_underscore_idx + 1:]

    # Validate seam ID exists and is non-empty
    if not seam_id or seam_id.strip() == '':
        return False, '', '', f"Missing mandatory seam ID before underscore. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')"

    # Validate seam ID contains only alphanumeric characters
    if not re.match(r'^[a-zA-Z0-9]+$', seam_id):
        return False, seam_id, '', f"Invalid seam ID '{seam_id}'. Seam ID must contain only letters and numbers."

    # Check if sheet number part exists
    if not after_seam_id or after_seam_id.strip() == '':
        return False, seam_id, '', f"Missing sheet number after underscore. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')"

    # Try format 1: 2 digits + separator + 4 digits (e.g., 43_3857)
    format1_match = re.match(r'^(\d{2})[-\s_](\d{4})(?:[-\s_]|$)', after_seam_id)
    if format1_match:
        sheet_number = format1_match.group(1) + format1_match.group(2)
        return True, seam_id, sheet_number, ''

    # Try format 2: 6 consecutive digits (e.g., 433857)
    format2_match = re.match(r'^(\d{6})(?:[-\s_]|$)', after_seam_id)
    if format2_match:
        sheet_number = format2_match.group(1)
        return True, seam_id, sheet_number, ''

    # If we get here, no valid 6-digit pattern was found
    # Count digits for better error message
    all_digits = re.sub(r'\D', '', after_seam_id)

    if len(all_digits) == 0:
        return False, seam_id, '', f"No digits found in sheet number part. Sheet number must be exactly 6 digits."
    elif len(all_digits) < 6:
        return False, seam_id, '', f"Sheet number must be exactly 6 digits, found {len(all_digits)} digits. Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip' or '16516_43_3857.zip')"
    elif len(all_digits) > 6:
        return False, seam_id, '', f"Sheet number has too many digits ({len(all_digits)}). First 6 digits must be at the start after seam ID, format: XXXXXX or XX_XXXX."
    else:
        # Exactly 6 digits but not at the start
        return False, seam_id, '', f"Sheet number format is incorrect. Expected 6 digits immediately after first underscore in format XXXXXX or XX_XXXX. Valid examples: '16516_433857.zip' or '16516_43_3857.zip'"


def get_s3_metadata(bucket: str, key: str) -> dict:
    """
    Retrieve metadata from the uploaded S3 object
    The frontend sets metadata when generating presigned URLs (jobId, mapId, submittedBy, etc.)
    This metadata tells us how to process the file and track it in DynamoDB
    """
    try:
        response = s3_client.head_object(Bucket=bucket, Key=key)
        return response.get("Metadata", {})
    except ClientError as exc:
        logging.exception("Failed to retrieve S3 metadata", extra={"bucket": bucket, "key": key})
        return {}  # Return empty dict if we can't get metadata


def create_map_entry(map_id: str, map_name: str, owner_email: str, size_bytes: int, timestamp: str, job_id: str) -> None:
    """
    Create a MAP entry in the MAPS table linked to a job
    This tracks individual file processing - each uploaded file gets its own map entry
    """
    if not MAPS_TABLE_NAME:
        logging.warning("MAPS_TABLE_NAME not configured, skipping MAP creation")
        return

    try:
        # Try to create a new map entry
        # The ConditionExpression prevents duplicates by checking if mapId/mapName combo exists
        dynamo.put_item(
            TableName=MAPS_TABLE_NAME,
            Item={
                "mapId": {"S": map_id},  # Hash-based ID from file content
                "mapName": {"S": map_name},  # Sanitized filename
                "ownerEmail": {"S": owner_email},
                "createdAt": {"S": timestamp},
                "sizeBytes": {"N": str(size_bytes)},
                "mapVersion": {"N": "1"},
                "jobId": {"S": job_id},
                "status": {"S": "QUEUED"}  # Start in QUEUED state
            },
            ConditionExpression="attribute_not_exists(mapId) AND attribute_not_exists(mapName)"
        )
        logging.info(f"Created MAP entry: {map_id} / {map_name} linked to job {job_id} with status QUEUED")
    except ClientError as exc:
        # If the map already exists, this might be a retry scenario
        # The frontend checks for FAILED maps and allows users to re-upload them
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code == "ConditionalCheckFailedException":
            logging.info(f"MAP entry already exists: {map_id} / {map_name}, updating for retry")
            # Update the existing map for retry:
            # 1. Reset status to QUEUED
            # 2. Link to new jobId
            # 3. Increment retry counter
            # 4. Clear old error message
            try:
                dynamo.update_item(
                    TableName=MAPS_TABLE_NAME,
                    Key={
                        "mapId": {"S": map_id},
                        "mapName": {"S": map_name}
                    },
                    UpdateExpression="SET #status = :status, jobId = :jobId, updatedAt = :updated, #retry = if_not_exists(#retry, :zero) + :inc REMOVE errorMessage",
                    ExpressionAttributeNames={
                        "#status": "status",  # Reserved word
                        "#retry": "retryCount"
                    },
                    ExpressionAttributeValues={
                        ":status": {"S": "QUEUED"},
                        ":jobId": {"S": job_id},
                        ":updated": {"S": timestamp},
                        ":inc": {"N": "1"},  # Increment retry count
                        ":zero": {"N": "0"}  # Start at 0 if retryCount doesn't exist
                    }
                )
                logging.info(f"Updated MAP entry for retry: {map_id} / {map_name}, reset to QUEUED")
            except ClientError as update_exc:
                logging.exception("Failed to update MAP entry for retry", extra={"mapId": map_id, "mapName": map_name})
        else:
            logging.exception("Failed to create MAP entry", extra={"mapId": map_id, "mapName": map_name})


def create_or_get_job(job_id: str, submitted_by: str, timestamp: str, batch_size: int) -> bool:
    """
    Create job entry if it doesn't exist
    Jobs track batches of uploaded files - multiple maps can belong to one job
    Returns True if created, False if already exists
    """
    if not TABLE_NAME:
        return False

    try:
        # Try to create a new job record
        # For batch uploads, all files share the same jobId (generated by frontend)
        # So we only create the job once, even if multiple Lambdas are triggered
        dynamo.put_item(
            TableName=TABLE_NAME,
            Item={
                "jobId": {"S": job_id},
                "submittedBy": {"S": submitted_by},
                "status": {"S": "QUEUED"},
                "createdAt": {"S": timestamp},
                "notificationStatus": {"S": "PENDING"},
                "attemptCount": {"N": "0"},
                "mapSource": {"S": "USER_UPLOAD"},
                "batchSize": {"N": str(batch_size)},  # How many files in this batch
                "processedCount": {"N": "0"},  # How many succeeded
                "failedCount": {"N": "0"}  # How many failed
            },
            ConditionExpression="attribute_not_exists(jobId)",  # Only create if doesn't exist
        )
        logging.info(f"Created job {job_id} for batch of {batch_size} files")
        return True
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code == "ConditionalCheckFailedException":
            # Job already exists - this is normal for batch uploads
            # Another Lambda invocation already created it
            logging.info(f"Job {job_id} already exists")
            return False
        else:
            logging.exception("Failed to create job", extra={"jobId": job_id})
            raise


def sync_map_status(job_id: str, new_status: str) -> None:
    """
    Synchronize map statuses with job status
    Updates all maps belonging to a job to match the job's current status
    This ensures consistency between map-jobs table and maps table
    """
    if not (MAPS_TABLE_NAME and job_id):
        return

    try:
        # Query all maps belonging to this job using the JobIdIndex GSI
        response = dynamo.query(
            TableName=MAPS_TABLE_NAME,
            IndexName="JobIdIndex",
            KeyConditionExpression="jobId = :jobId",
            ExpressionAttributeValues={
                ":jobId": {"S": job_id}
            }
        )

        maps = response.get("Items", [])
        timestamp = iso_timestamp()

        # Update each map's status to match the job status
        for map_item in maps:
            map_id = map_item.get("mapId", {}).get("S")
            map_name = map_item.get("mapName", {}).get("S")

            if map_id and map_name:
                try:
                    dynamo.update_item(
                        TableName=MAPS_TABLE_NAME,
                        Key={
                            "mapId": {"S": map_id},
                            "mapName": {"S": map_name}
                        },
                        UpdateExpression="SET #status = :status, updatedAt = :updated",
                        ExpressionAttributeNames={"#status": "status"},
                        ExpressionAttributeValues={
                            ":status": {"S": new_status},
                            ":updated": {"S": timestamp}
                        }
                    )
                    logging.info(f"Synced map {map_id}/{map_name} status to {new_status}")
                except ClientError as exc:
                    logging.exception(f"Failed to sync map status for {map_id}/{map_name}", extra={"error": str(exc)})

    except ClientError as exc:
        logging.exception(f"Failed to query maps for job {job_id}", extra={"error": str(exc)})


def mark_failed(job_id: str, reason: str) -> None:
    """Mark a job as FAILED in DynamoDB - used when Lambda itself fails"""
    if not (TABLE_NAME and job_id):
        return

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
    except ClientError:
        logging.exception("Failed to mark job as failed", extra={"jobId": job_id})


def launch_ecs_task(job_id: str, map_id: str, map_name: str, bucket: str, key: str) -> bool:
    """
    Launch ECS Fargate task to process the file
    This is the main processing path - each file gets its own ECS task
    The task will copy the file from input bucket to output bucket and update DynamoDB
    """
    # Make sure we have all the ECS config we need
    if not all([ECS_CLUSTER, ECS_TASK_DEFINITION, ECS_SUBNETS, ECS_SECURITY_GROUP]):
        logging.warning("ECS configuration incomplete, skipping ECS task launch")
        return False

    try:
        # Launch a new Fargate task
        # We pass the jobId, mapId, and S3 key as environment variables
        # The processor container reads these and knows what to process
        response = ecs_client.run_task(
            cluster=ECS_CLUSTER,
            taskDefinition=ECS_TASK_DEFINITION,
            launchType="FARGATE",  # Serverless - no need to manage EC2 instances
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": ECS_SUBNETS,
                    "securityGroups": [ECS_SECURITY_GROUP],
                    "assignPublicIp": "ENABLED"  # Needed to pull Docker image and access S3
                }
            },
            overrides={
                "containerOverrides": [
                    {
                        "name": "processor",  # Container name from task definition
                        "environment": [
                            {"name": "JOB_ID", "value": job_id},
                            {"name": "MAP_ID", "value": map_id},
                            {"name": "INPUT_KEY", "value": key},
                            {"name": "MAP_NAME", "value": map_name}  # Pass map_name explicitly
                        ]
                    }
                ]
            }
        )

        task_arn = response["tasks"][0]["taskArn"] if response.get("tasks") else None
        logging.info(f"Launched ECS task: {task_arn} for job {job_id}")
        return True

    except ClientError as exc:
        logging.exception("Failed to launch ECS task", extra={"job_id": job_id, "error": str(exc)})
        return False


def lambda_handler(event, _context):
    """
    Main Lambda handler - triggered by S3 upload events
    For each uploaded file:
    1. Extract metadata and file info
    2. Create/update job and map records in DynamoDB
    3. Launch ECS task to process the file
    4. Handle failures gracefully
    """
    # Basic config check - we need these to function
    if not TABLE_NAME or not S3_COPY_FUNCTION:
        raise RuntimeError("Missing JOBS_TABLE_NAME or S3_COPY_FUNCTION_NAME environment variables")

    records = []

    # Process each S3 event record (usually just one, but could be multiple)
    for record in event.get("Records", []):
        # Decode the S3 bucket and key from the event
        bucket = urllib.parse.unquote_plus(record["s3"]["bucket"]["name"])
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        timestamp = iso_timestamp()

        # Get basic file info from the S3 event
        size_bytes = record["s3"]["object"].get("size", 0)

        # Extract just the filename (no path)
        map_name = key.split('/')[-1] if '/' in key else key

        # Validate filename format - catches files that bypass frontend validation
        # This is a critical security check for direct S3 uploads
        is_valid, seam_id, sheet_number, error_msg = validate_filename(map_name)
        if not is_valid:
            logging.error(f"Invalid filename format: {map_name} - {error_msg}")

            # Get metadata to create proper tracking records even for invalid files
            metadata = get_s3_metadata(bucket, key)
            submitted_by = metadata.get("submittedby", "system")
            map_id = metadata.get("mapid", f"map_{uuid4().hex[:12]}")
            job_id = metadata.get("jobid", f"JobId-{str(uuid4())}")
            batch_size = int(metadata.get("batchsize", "1"))

            # Create/get job record
            try:
                create_or_get_job(job_id, submitted_by, timestamp, batch_size)
            except ClientError:
                logging.exception("Failed to create/get job record for invalid file")

            # Create MAP entry with FAILED status and validation error
            if MAPS_TABLE_NAME:
                try:
                    dynamo.put_item(
                        TableName=MAPS_TABLE_NAME,
                        Item={
                            "mapId": {"S": map_id},
                            "mapName": {"S": map_name},
                            "ownerEmail": {"S": submitted_by},
                            "createdAt": {"S": timestamp},
                            "sizeBytes": {"N": str(size_bytes)},
                            "mapVersion": {"N": "1"},
                            "jobId": {"S": job_id},
                            "status": {"S": "FAILED"},
                            "errorMessage": {"S": f"Invalid filename format: {error_msg}"}
                        }
                    )
                    logging.info(f"Created FAILED MAP entry for invalid filename: {map_name}")
                except ClientError:
                    logging.exception(f"Failed to create MAP entry for invalid file: {map_name}")

            # Record the failure and skip processing
            records.append({
                "jobId": job_id,
                "mapId": map_id,
                "bucket": bucket,
                "key": key,
                "status": "FAILED",
                "error": f"Invalid filename: {error_msg}"
            })
            continue  # Skip to next file

        # Get the metadata that the frontend set when uploading
        # This includes jobId, mapId (hash), batchSize, and who uploaded it
        metadata = get_s3_metadata(bucket, key)
        submitted_by = metadata.get("submittedby", "system")  # S3 lowercases metadata keys
        map_id = metadata.get("mapid", f"map_{uuid4().hex[:12]}")  # Hash-based ID for deduplication
        job_id = metadata.get("jobid", f"JobId-{str(uuid4())}")  # Batch ID from frontend
        batch_size = int(metadata.get("batchsize", "1"))  # How many files in this upload batch

        # Step 1: Create or get the job record
        # For batch uploads, all files share the same jobId
        # Only the first Lambda invocation actually creates it
        try:
            create_or_get_job(job_id, submitted_by, timestamp, batch_size)
        except ClientError as exc:
            message = exc.response.get("Error", {}).get("Message", str(exc))
            logging.exception("Failed to create/get job record", extra={"jobId": job_id})
            records.append({
                "jobId": job_id,
                "bucket": bucket,
                "key": key,
                "status": "FAILED",
                "error": message,
            })
            continue  # Skip this file, move to next

        # Step 2: Create the MAP entry for this specific file
        # This also handles retry logic - if the map exists and failed before,
        # we update it to QUEUED and increment the retry counter
        create_map_entry(map_id, map_name, submitted_by, size_bytes, timestamp, job_id)

        # Step 3: Launch the processing task
        try:
            # Try to launch ECS task (preferred method)
            ecs_launched = launch_ecs_task(job_id, map_id, map_name, bucket, key)

            if ecs_launched:
                # Success! Update job status to show we've dispatched it for processing
                dynamo.update_item(
                    TableName=TABLE_NAME,
                    Key={"jobId": {"S": job_id}},
                    UpdateExpression="SET #status = :status",
                    ExpressionAttributeNames={"#status": "status"},
                    ExpressionAttributeValues={
                        ":status": {"S": "DISPATCHED"}
                    },
                )

                # Update individual map status to DISPATCHED
                if MAPS_TABLE_NAME:
                    try:
                        dynamo.update_item(
                            TableName=MAPS_TABLE_NAME,
                            Key={
                                "mapId": {"S": map_id},
                                "mapName": {"S": map_name}
                            },
                            UpdateExpression="SET #status = :status, updatedAt = :updated",
                            ExpressionAttributeNames={"#status": "status"},
                            ExpressionAttributeValues={
                                ":status": {"S": "DISPATCHED"},
                                ":updated": {"S": timestamp}
                            }
                        )
                        logging.info(f"Updated map {map_id}/{map_name} status to DISPATCHED")
                    except ClientError as exc:
                        logging.exception(f"Failed to update map {map_id} to DISPATCHED", extra={"error": str(exc)})

                records.append({"jobId": job_id, "mapId": map_id, "bucket": bucket, "key": key, "status": "DISPATCHED"})
            else:
                # ECS launch failed - fall back to Lambda processor
                # This is a backup path in case ECS is unavailable
                logging.info(f"Falling back to Lambda processor for map {map_id} in job {job_id}")
                payload = json.dumps({
                    "jobId": job_id,
                    "mapId": map_id,
                    "bucket": bucket,
                    "key": key,
                    "project": PROJECT
                }).encode("utf-8")
                lambda_client.invoke(
                    FunctionName=S3_COPY_FUNCTION,
                    InvocationType="Event",  # Async invocation
                    Payload=payload,
                )

                # Mark job as dispatched even though we used Lambda fallback
                dynamo.update_item(
                    TableName=TABLE_NAME,
                    Key={"jobId": {"S": job_id}},
                    UpdateExpression="SET #status = :status",
                    ExpressionAttributeNames={"#status": "status"},
                    ExpressionAttributeValues={
                        ":status": {"S": "DISPATCHED"}
                    },
                )

                # Update individual map status to DISPATCHED
                if MAPS_TABLE_NAME:
                    try:
                        dynamo.update_item(
                            TableName=MAPS_TABLE_NAME,
                            Key={
                                "mapId": {"S": map_id},
                                "mapName": {"S": map_name}
                            },
                            UpdateExpression="SET #status = :status, updatedAt = :updated",
                            ExpressionAttributeNames={"#status": "status"},
                            ExpressionAttributeValues={
                                ":status": {"S": "DISPATCHED"},
                                ":updated": {"S": timestamp}
                            }
                        )
                        logging.info(f"Updated map {map_id}/{map_name} status to DISPATCHED (Lambda fallback)")
                    except ClientError as exc:
                        logging.exception(f"Failed to update map {map_id} to DISPATCHED", extra={"error": str(exc)})

                records.append({"jobId": job_id, "mapId": map_id, "bucket": bucket, "key": key, "status": "DISPATCHED"})
        except ClientError as exc:
            # Something went wrong with dispatching - mark the whole job as failed
            message = exc.response.get("Error", {}).get("Message", str(exc))
            logging.exception("Failed to dispatch map", extra={"job_id": job_id, "map_id": map_id, "bucket": bucket, "key": key})
            mark_failed(job_id, message)
            records.append({
                "jobId": job_id,
                "mapId": map_id,
                "bucket": bucket,
                "key": key,
                "status": "FAILED",
                "error": message,
            })

    # Return summary of what we processed
    return {"records": records}
