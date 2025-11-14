# Input handler - triggered when files are uploaded to the S3 input bucket
# Extracts metadata, creates DynamoDB entries, and launches ECS tasks to process the files

import json
import logging
import os
import urllib.parse
from datetime import datetime
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError

# AWS clients
dynamo = boto3.client("dynamodb")
lambda_client = boto3.client("lambda")
s3_client = boto3.client("s3")
ecs_client = boto3.client("ecs")

# Environment config (set by Terraform)
TABLE_NAME = os.getenv("JOBS_TABLE_NAME")  # DynamoDB table for tracking jobs
MAPS_TABLE_NAME = os.getenv("MAPS_TABLE_NAME")  # DynamoDB table for individual maps
S3_COPY_FUNCTION = os.getenv("S3_COPY_FUNCTION_NAME")  # Fallback Lambda processor
ECS_CLUSTER = os.getenv("ECS_CLUSTER")  # ECS cluster name
ECS_TASK_DEFINITION = os.getenv("ECS_TASK_DEFINITION")  # Task definition for processing
ECS_SUBNETS = os.getenv("ECS_SUBNETS", "").split(",")  # VPC subnets for ECS tasks
ECS_SECURITY_GROUP = os.getenv("ECS_SECURITY_GROUP")  # Security group for ECS tasks
PROJECT = os.getenv("PROJECT_NAME", "mra-mines")  # Project name for tagging


def iso_timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


def truncate(value: str, limit: int = 500) -> str:
    return value[:limit] if value else ""


def get_s3_metadata(bucket: str, key: str) -> dict:
    # Frontend sets metadata with jobId, mapId, submittedBy when uploading
    try:
        response = s3_client.head_object(Bucket=bucket, Key=key)
        return response.get("Metadata", {})
    except ClientError as exc:
        logging.exception("Failed to retrieve S3 metadata", extra={"bucket": bucket, "key": key})
        return {}


def create_map_entry(map_id: str, map_name: str, owner_email: str, size_bytes: int, timestamp: str, job_id: str) -> None:
    # Create map entry in DynamoDB - one entry per uploaded file
    if not MAPS_TABLE_NAME:
        logging.warning("MAPS_TABLE_NAME not configured, skipping MAP creation")
        return

    try:
        # Create new map entry (ConditionExpression prevents duplicates)
        dynamo.put_item(
            TableName=MAPS_TABLE_NAME,
            Item={
                "mapId": {"S": map_id},
                "mapName": {"S": map_name},
                "ownerEmail": {"S": owner_email},
                "createdAt": {"S": timestamp},
                "sizeBytes": {"N": str(size_bytes)},
                "mapVersion": {"N": "1"},
                "jobId": {"S": job_id},
                "status": {"S": "QUEUED"}
            },
            ConditionExpression="attribute_not_exists(mapId) AND attribute_not_exists(mapName)"
        )
        logging.info(f"Created MAP entry: {map_id} / {map_name} linked to job {job_id} with status QUEUED")
    except ClientError as exc:
        # Map exists - update for retry if it's a re-upload
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code == "ConditionalCheckFailedException":
            logging.info(f"MAP entry already exists: {map_id} / {map_name}, updating for retry")
            # Reset status, link to new job, increment retry counter, clear error
            try:
                dynamo.update_item(
                    TableName=MAPS_TABLE_NAME,
                    Key={
                        "mapId": {"S": map_id},
                        "mapName": {"S": map_name}
                    },
                    UpdateExpression="SET #status = :status, jobId = :jobId, updatedAt = :updated, #retry = if_not_exists(#retry, :zero) + :inc REMOVE errorMessage",
                    ExpressionAttributeNames={
                        "#status": "status",
                        "#retry": "retryCount"
                    },
                    ExpressionAttributeValues={
                        ":status": {"S": "QUEUED"},
                        ":jobId": {"S": job_id},
                        ":updated": {"S": timestamp},
                        ":inc": {"N": "1"},
                        ":zero": {"N": "0"}
                    }
                )
                logging.info(f"Updated MAP entry for retry: {map_id} / {map_name}, reset to QUEUED")
            except ClientError as update_exc:
                logging.exception("Failed to update MAP entry for retry", extra={"mapId": map_id, "mapName": map_name})
        else:
            logging.exception("Failed to create MAP entry", extra={"mapId": map_id, "mapName": map_name})


def create_or_get_job(job_id: str, submitted_by: str, timestamp: str, batch_size: int) -> bool:
    # Create job entry for batch upload (all files share same jobId)
    # Returns True if created, False if already exists
    if not TABLE_NAME:
        return False

    try:
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
                "batchSize": {"N": str(batch_size)},
                "processedCount": {"N": "0"},
                "failedCount": {"N": "0"}
            },
            ConditionExpression="attribute_not_exists(jobId)",
        )
        logging.info(f"Created job {job_id} for batch of {batch_size} files")
        return True
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code == "ConditionalCheckFailedException":
            # Normal for batch uploads - another Lambda already created it
            logging.info(f"Job {job_id} already exists")
            return False
        else:
            logging.exception("Failed to create job", extra={"jobId": job_id})
            raise


def mark_failed(job_id: str, reason: str) -> None:
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
    # Launch Fargate task to process the file
    if not all([ECS_CLUSTER, ECS_TASK_DEFINITION, ECS_SUBNETS, ECS_SECURITY_GROUP]):
        logging.warning("ECS configuration incomplete, skipping ECS task launch")
        return False

    try:
        response = ecs_client.run_task(
            cluster=ECS_CLUSTER,
            taskDefinition=ECS_TASK_DEFINITION,
            launchType="FARGATE",
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": ECS_SUBNETS,
                    "securityGroups": [ECS_SECURITY_GROUP],
                    "assignPublicIp": "ENABLED"
                }
            },
            overrides={
                "containerOverrides": [
                    {
                        "name": "processor",
                        "environment": [
                            {"name": "JOB_ID", "value": job_id},
                            {"name": "MAP_ID", "value": map_id},
                            {"name": "INPUT_KEY", "value": key},
                            {"name": "MAP_NAME", "value": map_name}
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
    if not TABLE_NAME or not S3_COPY_FUNCTION:
        raise RuntimeError("Missing JOBS_TABLE_NAME or S3_COPY_FUNCTION_NAME environment variables")

    records = []

    for record in event.get("Records", []):
        bucket = urllib.parse.unquote_plus(record["s3"]["bucket"]["name"])
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        timestamp = iso_timestamp()
        size_bytes = record["s3"]["object"].get("size", 0)
        map_name = key.split('/')[-1] if '/' in key else key

        # Get metadata (S3 lowercases keys)
        metadata = get_s3_metadata(bucket, key)
        submitted_by = metadata.get("submittedby", "system")
        map_id = metadata.get("mapid", f"map_{uuid4().hex[:12]}")
        job_id = metadata.get("jobid", f"JobId-{str(uuid4())}")
        batch_size = int(metadata.get("batchsize", "1"))

        # Create job entry
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
            continue

        # Create map entry (handles retry if file was re-uploaded)
        create_map_entry(map_id, map_name, submitted_by, size_bytes, timestamp, job_id)

        # Launch ECS task or fallback to Lambda
        try:
            ecs_launched = launch_ecs_task(job_id, map_id, map_name, bucket, key)

            if ecs_launched:
                dynamo.update_item(
                    TableName=TABLE_NAME,
                    Key={"jobId": {"S": job_id}},
                    UpdateExpression="SET #status = :status",
                    ExpressionAttributeNames={"#status": "status"},
                    ExpressionAttributeValues={
                        ":status": {"S": "DISPATCHED"}
                    },
                )
                records.append({"jobId": job_id, "mapId": map_id, "bucket": bucket, "key": key, "status": "DISPATCHED"})
            else:
                # Fallback to Lambda processor
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
                    InvocationType="Event",
                    Payload=payload,
                )

                dynamo.update_item(
                    TableName=TABLE_NAME,
                    Key={"jobId": {"S": job_id}},
                    UpdateExpression="SET #status = :status",
                    ExpressionAttributeNames={"#status": "status"},
                    ExpressionAttributeValues={
                        ":status": {"S": "DISPATCHED"}
                    },
                )
                records.append({"jobId": job_id, "mapId": map_id, "bucket": bucket, "key": key, "status": "DISPATCHED"})
        except ClientError as exc:
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

    return {"records": records}
