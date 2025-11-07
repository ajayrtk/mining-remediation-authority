import json
import logging
import os
from datetime import datetime

import boto3
from botocore.exceptions import ClientError


dynamo = boto3.client("dynamodb")
s3 = boto3.client("s3")

TABLE_NAME = os.getenv("JOBS_TABLE_NAME")
OUTPUT_BUCKET = os.getenv("OUTPUT_BUCKET")
PROJECT = os.getenv("PROJECT_NAME", "mra-mines")


def iso_timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


def update_status(job_id: str, status: str, extra_attributes: dict | None = None) -> None:
    if not (TABLE_NAME and job_id):
        return

    expression_parts = ["#status = :status", "updated_at = :updated_at"]
    names = {"#status": "status"}
    values = {
        ":status": {"S": status},
        ":updated_at": {"S": iso_timestamp()},
    }

    extra_attributes = extra_attributes or {}
    for index, (key, value) in enumerate(extra_attributes.items()):
        attr_name = f"#extra_{index}"
        attr_value = f":extra_{index}"
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
        logging.exception("Failed to update job status", extra={"job_id": job_id, "status": status})


def extract_payloads(event):
    if isinstance(event, list):
        return event

    records = event.get("Records") if isinstance(event, dict) else None
    if isinstance(records, list):
        payloads = []
        for record in records:
            body = record.get("body") if isinstance(record, dict) else None
            if body:
                try:
                    payloads.append(json.loads(body))
                except json.JSONDecodeError:
                    payloads.append(body)
            else:
                payloads.append(record)
        return payloads

    return [event]


def lambda_handler(event, _context):
    if not TABLE_NAME or not OUTPUT_BUCKET:
        raise RuntimeError("Missing JOBS_TABLE_NAME or OUTPUT_BUCKET environment variables")

    for payload in extract_payloads(event):
        job_id = None
        try:
            job_id = payload.get("jobId") if isinstance(payload, dict) else None
            source_bucket = payload.get("bucket") if isinstance(payload, dict) else None
            source_key = payload.get("key") if isinstance(payload, dict) else None

            if not all([job_id, source_bucket, source_key]):
                raise ValueError("Payload missing jobId, bucket, or key")

            update_status(
                job_id,
                "PROCESSING",
                {"source_bucket": source_bucket, "source_key": source_key},
            )

            if payload.get("simulateFailure") or "fail" in source_key.lower():
                raise ValueError("Simulated ML processing failure")

            processed_at = iso_timestamp()
            output_key = f"{job_id}-result.json"

            s3.put_object(
                Bucket=OUTPUT_BUCKET,
                Key=output_key,
                Body=json.dumps(
                    {
                        "jobId": job_id,
                        "source": {"bucket": source_bucket, "key": source_key},
                        "processedAt": processed_at,
                        "project": PROJECT,
                    }
                ).encode("utf-8"),
                ContentType="application/json",
                Metadata={"jobid": job_id},
            )

            update_status(
                job_id,
                "AWAITING_OUTPUT",
                {
                    "processed_at": processed_at,
                    "output_bucket": OUTPUT_BUCKET,
                    "output_key": output_key,
                },
            )
        except Exception as exc:  # broad to ensure job gets marked failed
            logging.exception("Mock ECS job failed", extra={"job_id": job_id})
            if job_id:
                update_status(
                    job_id,
                    "FAILED",
                    {"error_message": str(exc)[:500]},
                )

    return {"status": "ok"}
