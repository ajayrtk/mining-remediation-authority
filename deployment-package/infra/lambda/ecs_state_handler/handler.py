# Lambda ECS State Handler
# This Lambda is triggered by EventBridge when ECS task state changes
# Main responsibilities:
# 1. Capture taskStartedAt timestamp when ECS task transitions to RUNNING
# 2. Update map record in DynamoDB with timing metrics
# 3. Capture taskStoppedAt when task completes or fails

import json
import logging
import os
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS service clients
dynamo = boto3.client("dynamodb")
ecs_client = boto3.client("ecs")

# Configuration from environment variables
MAPS_TABLE_NAME = os.getenv("MAPS_TABLE_NAME")
ECS_CLUSTER = os.getenv("ECS_CLUSTER")


def iso_timestamp() -> str:
    """Generate ISO 8601 timestamp for DynamoDB"""
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


def extract_map_info_from_task(task_arn: str, cluster: str) -> tuple[str | None, str | None]:
    """
    Extract mapId and mapName from ECS task environment variables.
    The input_handler Lambda passes these when launching the task.

    Returns: (map_id, map_name) or (None, None) if not found
    """
    try:
        response = ecs_client.describe_tasks(
            cluster=cluster,
            tasks=[task_arn]
        )

        tasks = response.get("tasks", [])
        if not tasks:
            logger.warning(f"No task found for ARN: {task_arn}")
            return None, None

        task = tasks[0]

        # Get the container overrides to find MAP_ID and MAP_NAME
        overrides = task.get("overrides", {})
        container_overrides = overrides.get("containerOverrides", [])

        map_id = None
        map_name = None

        for container in container_overrides:
            env_vars = container.get("environment", [])
            for env_var in env_vars:
                if env_var.get("name") == "MAP_ID":
                    map_id = env_var.get("value")
                elif env_var.get("name") == "MAP_NAME":
                    map_name = env_var.get("value")

        if map_id and map_name:
            logger.info(f"Found map info from task {task_arn}: mapId={map_id}, mapName={map_name}")
            return map_id, map_name
        else:
            logger.warning(f"Could not extract map info from task {task_arn}")
            return None, None

    except ClientError as exc:
        logger.exception(f"Failed to describe task {task_arn}", extra={"error": str(exc)})
        return None, None


def update_map_timing(map_id: str, map_name: str, field_name: str, timestamp: str, task_arn: str = None) -> bool:
    """
    Update map record with timing metric.

    Args:
        map_id: Map ID (hash key)
        map_name: Map name (sort key)
        field_name: Name of the timestamp field to set (e.g., 'taskStartedAt', 'taskStoppedAt')
        timestamp: ISO 8601 timestamp value
        task_arn: Optional task ARN to store

    Returns: True if successful
    """
    if not MAPS_TABLE_NAME:
        logger.warning("MAPS_TABLE_NAME not configured")
        return False

    try:
        update_expr = f"SET {field_name} = :ts, updatedAt = :updated"
        expr_values = {
            ":ts": {"S": timestamp},
            ":updated": {"S": timestamp}
        }

        if task_arn:
            update_expr += ", taskArn = :taskArn"
            expr_values[":taskArn"] = {"S": task_arn}

        dynamo.update_item(
            TableName=MAPS_TABLE_NAME,
            Key={
                "mapId": {"S": map_id},
                "mapName": {"S": map_name}
            },
            UpdateExpression=update_expr,
            ExpressionAttributeValues=expr_values
        )
        logger.info(f"Updated map {map_id}/{map_name} with {field_name}={timestamp}")
        return True

    except ClientError as exc:
        logger.exception(f"Failed to update map timing", extra={
            "map_id": map_id,
            "map_name": map_name,
            "field_name": field_name,
            "error": str(exc)
        })
        return False


def lambda_handler(event, _context):
    """
    Main Lambda handler - triggered by EventBridge ECS task state changes.

    EventBridge sends events for:
    - PROVISIONING -> PENDING -> RUNNING -> STOPPED

    We capture:
    - taskStartedAt: When task transitions to RUNNING
    - taskStoppedAt: When task transitions to STOPPED
    """
    logger.info(f"Received ECS state change event: {json.dumps(event)}")

    # Validate event structure
    detail = event.get("detail", {})
    if not detail:
        logger.error("Event missing 'detail' field")
        return {"statusCode": 400, "body": "Invalid event structure"}

    # Extract task information
    task_arn = detail.get("taskArn")
    cluster_arn = detail.get("clusterArn")
    last_status = detail.get("lastStatus")
    desired_status = detail.get("desiredStatus")

    if not task_arn or not cluster_arn:
        logger.error("Event missing taskArn or clusterArn")
        return {"statusCode": 400, "body": "Missing task information"}

    logger.info(f"Task {task_arn} status: {last_status} (desired: {desired_status})")

    # Extract cluster name from ARN
    # Format: arn:aws:ecs:region:account:cluster/cluster-name
    cluster_name = cluster_arn.split("/")[-1] if "/" in cluster_arn else cluster_arn

    # Get map info from task
    map_id, map_name = extract_map_info_from_task(task_arn, cluster_name)
    if not map_id or not map_name:
        logger.warning(f"Could not extract map info for task {task_arn}, skipping update")
        return {"statusCode": 200, "body": "No map info found"}

    timestamp = iso_timestamp()

    # Handle different state transitions
    if last_status == "RUNNING":
        # Task just started running - capture taskStartedAt
        # This is when the container actually begins processing
        update_map_timing(map_id, map_name, "taskStartedAt", timestamp, task_arn)
        logger.info(f"Captured taskStartedAt for map {map_id}/{map_name}")

    elif last_status == "STOPPED":
        # Task stopped - capture taskStoppedAt
        # Also capture stop reason if available
        update_map_timing(map_id, map_name, "taskStoppedAt", timestamp, task_arn)

        # Check if task failed
        stop_code = detail.get("stopCode")
        stopped_reason = detail.get("stoppedReason")

        if stop_code and stop_code != "EssentialContainerExited" or \
           (stopped_reason and "error" in stopped_reason.lower()):
            logger.warning(f"Task {task_arn} stopped with error: {stop_code} - {stopped_reason}")
            # Note: The output_handler Lambda handles status updates to COMPLETED/FAILED
            # This Lambda only captures timing metrics

        logger.info(f"Captured taskStoppedAt for map {map_id}/{map_name}")

    return {
        "statusCode": 200,
        "body": json.dumps({
            "task_arn": task_arn,
            "status": last_status,
            "map_id": map_id,
            "map_name": map_name
        })
    }
