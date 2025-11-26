import logging
import os
import urllib.parse
from datetime import datetime

import boto3
from botocore.exceptions import ClientError


dynamo = boto3.client("dynamodb")
s3 = boto3.client("s3")

TABLE_NAME = os.getenv("JOBS_TABLE_NAME")
SENDER = os.getenv("SES_SENDER", "no-reply@example.com")
PROJECT = os.getenv("PROJECT_NAME", "mra-mines")


def iso_timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


def truncate(value: str, limit: int = 500) -> str:
    return value[:limit] if value else ""


def finalize_job(job_id: str, status: str, extra: dict | None = None) -> None:
    if not (job_id and TABLE_NAME):
        return

    extra = extra or {}

    expression_parts = ["#status = :status", "updated_at = :updated_at"]
    names = {"#status": "status"}
    values = {
        ":status": {"S": status},
        ":updated_at": {"S": iso_timestamp()},
    }

    for index, (key, value) in enumerate(extra.items()):
        attr_name = f"#attr_{index}"
        attr_value = f":val_{index}"
        expression_parts.append(f"{attr_name} = {attr_value}")
        names[attr_name] = key
        values[attr_value] = {"S": value}

    try:
        dynamo.update_item(
            TableName=TABLE_NAME,
            Key={"jobId": {"S": job_id}},
            UpdateExpression="SET " + ", ".join(expression_parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError:
        logging.exception("Failed to finalize job", extra={"job_id": job_id, "status": status})


def validate_s3_event(event: dict) -> bool:
    """Validate S3 event structure."""
    if not isinstance(event, dict):
        raise ValueError(f"Event must be a dict, got {type(event).__name__}")

    if "Records" not in event:
        raise ValueError("Event missing 'Records' field")

    if not isinstance(event["Records"], list):
        raise ValueError("Records must be a list")

    return True


def validate_s3_record(record: dict) -> tuple[str, str]:
    """Validate and extract S3 bucket and key from event record."""
    if not isinstance(record, dict):
        raise ValueError(f"Record must be a dict, got {type(record).__name__}")

    # Check nested structure
    if "s3" not in record:
        raise ValueError("Record missing 's3' field")

    s3_data = record["s3"]
    if not isinstance(s3_data, dict):
        raise ValueError("s3 field must be a dict")

    if "bucket" not in s3_data or "object" not in s3_data:
        raise ValueError("s3 record missing 'bucket' or 'object' field")

    if "name" not in s3_data["bucket"]:
        raise ValueError("bucket missing 'name' field")

    if "key" not in s3_data["object"]:
        raise ValueError("object missing 'key' field")

    bucket = urllib.parse.unquote_plus(s3_data["bucket"]["name"])
    key = urllib.parse.unquote_plus(s3_data["object"]["key"])

    if not bucket or not key:
        raise ValueError("bucket name and object key must be non-empty")

    return bucket, key


def lambda_handler(event, _context):
    if not TABLE_NAME:
        raise RuntimeError("Missing JOBS_TABLE_NAME environment variable")

    # Validate event structure
    try:
        validate_s3_event(event)
    except ValueError as e:
        logging.error(f"Invalid event structure: {e}", extra={"event": str(event)[:1000]})
        return {"status": "error", "message": str(e)}

    for record in event.get("Records", []):
        job_id = None

        try:
            # Validate and extract S3 information
            bucket, key = validate_s3_record(record)
        except ValueError as e:
            logging.error(f"Invalid S3 record: {e}", extra={"record": str(record)[:500]})
            continue

        try:
            head = s3.head_object(Bucket=bucket, Key=key)
            job_id = head.get("Metadata", {}).get("jobid")

            if not job_id:
                raise ValueError("Output object missing jobid metadata")

            finalize_job(
                job_id,
                "COMPLETED",
                {"output_bucket": bucket, "output_key": key},
            )

            logging.info(
                "[MOCK SES] Job %s completed. Notify recipient from %s. Project %s. Output s3://%s/%s",
                job_id,
                SENDER,
                PROJECT,
                bucket,
                key,
            )
        except Exception as exc:
            logging.exception("Failed to finalize job", extra={"bucket": bucket, "key": key})
            if job_id:
                finalize_job(
                    job_id,
                    "FAILED",
                    {"error_message": truncate(str(exc))},
                )

    return {"status": "ok"}
