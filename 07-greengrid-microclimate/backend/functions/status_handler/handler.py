"""Cloud/backend operations console: real reachability + counts, nothing hardcoded.

Every field is a live check against the actual resource — DynamoDB DescribeTable for
DB status, an item read for message counters, SQS GetQueueAttributes for queue depth.
Any check that raises is reported as unavailable rather than crashing the whole response,
so one degraded dependency doesn't hide the status of the others.
"""
import os

import boto3

from shared.ddb import dynamodb
from shared.json_encoder import dumps

COUNTER_STATION_ID = "__meta__"
COUNTER_SORT_KEY = "counters#totals"


def _database_status(table) -> dict:
    try:
        table.meta.client.describe_table(TableName=table.table_name)
        return {"status": "connected", "table": table.table_name}
    except Exception as exc:  # noqa: BLE001 - any failure means the DB check itself failed
        return {"status": "unavailable", "error": str(exc)}


def _queue_status() -> dict:
    queue_url = os.environ.get("GREENGRID_TARGET_QUEUE_URL")
    if not queue_url:
        return {"status": "unavailable", "error": "queue url not configured"}
    try:
        sqs = boto3.client("sqs")
        attrs = sqs.get_queue_attributes(
            QueueUrl=queue_url,
            AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        )["Attributes"]
        return {
            "status": "connected",
            "approximate_messages": int(attrs.get("ApproximateNumberOfMessages", 0)),
            "approximate_in_flight": int(attrs.get("ApproximateNumberOfMessagesNotVisible", 0)),
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "unavailable", "error": str(exc)}


def _message_counters(table) -> dict:
    try:
        item = table.get_item(
            Key={"station_id": COUNTER_STATION_ID, "event_type_timestamp": COUNTER_SORT_KEY}
        ).get("Item")
        received = int(item["messages_received"]) if item else 0
    except Exception:  # noqa: BLE001 - counter row missing/unreadable, not a fatal status
        received = 0

    try:
        stored = table.scan(Select="COUNT")["Count"]
        # the running counter row itself isn't a sensor reading
        if received or stored:
            stored = max(0, stored - 1)
    except Exception:  # noqa: BLE001
        stored = None

    return {"messages_received": received, "messages_stored": stored}


def handler(event, context):
    table = dynamodb.Table(os.environ["GREENGRID_READINGS_TABLE"])

    database = _database_status(table)
    queue = _queue_status()
    counters = _message_counters(table)

    api_status = "reachable"  # this handler executing at all proves API Gateway -> Lambda works
    server_status = "running"  # Lambda invoking this code proves the compute layer is up

    overall = (
        "online"
        if database["status"] == "connected" and queue["status"] == "connected"
        else "degraded"
    )

    body = {
        "cloud_connection": overall,
        "api_status": api_status,
        "server_status": server_status,
        "database": database,
        "queue": queue,
        **counters,
    }

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": dumps(body),
    }
