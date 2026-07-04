"""API Gateway HTTP API handler for GET /health — real reachability checks, no hardcoded status."""
import os
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.json_encoder import dumps

READINGS_TABLE = os.environ["AQUASENTINEL_READINGS_TABLE"]
ALERTS_TABLE = os.environ["AQUASENTINEL_ALERTS_TABLE"]
READINGS_QUEUE_URL = os.environ["AQUASENTINEL_READINGS_QUEUE_URL"]
ALERTS_QUEUE_URL = os.environ["AQUASENTINEL_ALERTS_QUEUE_URL"]

dynamodb = boto3.client("dynamodb")
sqs = boto3.client("sqs")


def _table_check(table_name: str) -> dict[str, Any]:
    # DescribeTable is a genuine round trip to DynamoDB -- ACTIVE means the table is really there.
    try:
        result = dynamodb.describe_table(TableName=table_name)
        status = result["Table"]["TableStatus"]
        return {"table": table_name, "status": "connected" if status == "ACTIVE" else "unavailable", "table_status": status}
    except (ClientError, BotoCoreError) as exc:
        return {"table": table_name, "status": "unavailable", "error": str(exc)}


def _queue_check(queue_url: str) -> dict[str, Any]:
    # GetQueueAttributes succeeding proves both network reachability and queue existence.
    try:
        result = sqs.get_queue_attributes(
            QueueUrl=queue_url, AttributeNames=["ApproximateNumberOfMessages"]
        )
        depth = int(result["Attributes"]["ApproximateNumberOfMessages"])
        return {"queue_url": queue_url, "status": "connected", "approximate_messages": depth}
    except (ClientError, BotoCoreError) as exc:
        return {"queue_url": queue_url, "status": "unavailable", "error": str(exc)}


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {"statusCode": status, "body": dumps(body)}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    readings_table_check = _table_check(READINGS_TABLE)
    alerts_table_check = _table_check(ALERTS_TABLE)
    readings_queue_check = _queue_check(READINGS_QUEUE_URL)
    alerts_queue_check = _queue_check(ALERTS_QUEUE_URL)

    database_connected = readings_table_check["status"] == "connected" and alerts_table_check["status"] == "connected"
    queues_connected = readings_queue_check["status"] == "connected" and alerts_queue_check["status"] == "connected"
    # this handler itself running and answering IS the API/server liveness signal -- no separate probe needed
    server_status = "running"

    body = {
        "api_status": "reachable",
        "server_status": server_status,
        "database_status": "connected" if database_connected else "unavailable",
        "queue_status": "connected" if queues_connected else "unavailable",
        "cloud_connection": "connected" if (database_connected and queues_connected) else "unreachable",
        "tables": [readings_table_check, alerts_table_check],
        "queues": [readings_queue_check, alerts_queue_check],
    }
    overall_ok = database_connected and queues_connected
    return _response(200 if overall_ok else 503, body)
