"""API Gateway HTTP API handler for GET /metrics — real running counters, no fabricated numbers."""
import os
from typing import Any

import boto3

from shared import counters
from shared.json_encoder import dumps

READINGS_TABLE = os.environ["AQUASENTINEL_READINGS_TABLE"]
ALERTS_TABLE = os.environ["AQUASENTINEL_ALERTS_TABLE"]
COUNTERS_TABLE = os.environ.get("AQUASENTINEL_COUNTERS_TABLE", counters.COUNTERS_TABLE)

dynamodb = boto3.resource("dynamodb")


def _item_count(table_name: str) -> int:
    # DynamoDB's own ItemCount is only updated ~every 6h, so a live Scan(Select=COUNT) is the
    # genuine figure for a dashboard that must reflect what was actually just stored.
    table = dynamodb.Table(table_name)
    total = 0
    kwargs: dict[str, Any] = {"Select": "COUNT"}
    while True:
        result = table.scan(**kwargs)
        total += result.get("Count", 0)
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break
        kwargs["ExclusiveStartKey"] = last_key
    return total


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {"statusCode": status, "body": dumps(body)}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    try:
        counter_values = counters.read_all(COUNTERS_TABLE)
        readings_received = counter_values.get(counters.READINGS_RECEIVED, 0)
        alerts_received = counter_values.get(counters.ALERTS_RECEIVED, 0)

        readings_stored = _item_count(READINGS_TABLE)
        alerts_stored = _item_count(ALERTS_TABLE)

        body = {
            "messages_received_total": readings_received + alerts_received,
            "readings_received_total": readings_received,
            "alerts_received_total": alerts_received,
            "messages_stored_total": readings_stored + alerts_stored,
            "readings_stored_total": readings_stored,
            "alerts_stored_total": alerts_stored,
        }
        return _response(200, body)
    except Exception as exc:
        print(f"system_metrics failed: {exc}")
        return _response(500, {"error": "internal error"})
