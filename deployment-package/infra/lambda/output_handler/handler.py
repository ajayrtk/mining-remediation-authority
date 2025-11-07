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
            Key={"job_id": {"S": job_id}},
            UpdateExpression="SET " + ", ".join(expression_parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError:
        logging.exception("Failed to finalize job", extra={"job_id": job_id, "status": status})


def lambda_handler(event, _context):
    if not TABLE_NAME:
        raise RuntimeError("Missing JOBS_TABLE_NAME environment variable")

    for record in event.get("Records", []):
        bucket = urllib.parse.unquote_plus(record["s3"]["bucket"]["name"])
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        job_id = None

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
