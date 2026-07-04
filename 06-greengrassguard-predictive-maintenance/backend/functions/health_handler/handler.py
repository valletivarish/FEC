"""API Gateway HTTP API handler for GET /health: real reachability checks against
DynamoDB and SQS, not hardcoded status strings, for the dashboard's Backend Status page."""
import os
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.json_encoder import dumps
from shared.ops_counters import read_counters


def _check_dynamodb() -> dict[str, Any]:
    table_name = os.environ["GUARD_DIAGNOSIS_TABLE"]
    try:
        client = boto3.client("dynamodb")
        description = client.describe_table(TableName=table_name)["Table"]
        return {
            "status": "connected",
            "table_status": description["TableStatus"],
            "item_count_estimate": description.get("ItemCount", 0),
        }
    except (ClientError, BotoCoreError) as exc:
        return {"status": "unavailable", "error": str(exc)}


def _check_sqs() -> dict[str, Any]:
    queue_url = os.environ.get("GUARD_INTAKE_QUEUE_URL")
    if not queue_url:
        return {"status": "unavailable", "error": "GUARD_INTAKE_QUEUE_URL not configured"}
    try:
        client = boto3.client("sqs")
        attrs = client.get_queue_attributes(
            QueueUrl=queue_url,
            AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        )["Attributes"]
        return {
            "status": "connected",
            "approximate_messages": int(attrs.get("ApproximateNumberOfMessages", 0)),
            "approximate_in_flight": int(attrs.get("ApproximateNumberOfMessagesNotVisible", 0)),
        }
    except (ClientError, BotoCoreError) as exc:
        return {"status": "unavailable", "error": str(exc)}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    dynamodb_health = _check_dynamodb()
    sqs_health = _check_sqs()
    counters = read_counters()

    # "server" here is this Lambda itself — if this code is executing at all, the
    # API Gateway -> Lambda hop that fronts every other route is demonstrably up.
    overall_ok = dynamodb_health["status"] == "connected" and sqs_health["status"] == "connected"

    body = {
        "api_status": "reachable",
        "server_status": "running",
        "database": dynamodb_health,
        "queue": sqs_health,
        "cloud_connection": "reachable" if overall_ok else "degraded",
        "messages_received": counters["messages_received"],
        "messages_stored": counters["messages_stored"],
    }

    return {"statusCode": 200 if overall_ok else 503, "body": dumps(body)}
