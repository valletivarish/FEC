"""SQS-triggered Lambda that persists fog-triaged readings (life_support, ops_feed_correlation)."""
import json
import os
from typing import Any

import boto3

from shared import counters
from shared.json_encoder import to_decimal

READINGS_TABLE = os.environ["AQUASENTINEL_READINGS_TABLE"]
COUNTERS_TABLE = os.environ.get("AQUASENTINEL_COUNTERS_TABLE", counters.COUNTERS_TABLE)

dynamodb = boto3.resource("dynamodb")


def _sort_key(event_body: dict[str, Any]) -> str:
    # Sort key groups readings by type then time so a pond's history stays queryable in order.
    return f"{event_body['type']}#{event_body['timestamp']}"


def handler(event: dict[str, Any], context: Any) -> None:
    table = dynamodb.Table(READINGS_TABLE)
    records = event.get("Records", [])
    if records:
        # counted on receipt regardless of per-record parse outcome -- this is what the backend genuinely ingested
        counters.increment(COUNTERS_TABLE, counters.READINGS_RECEIVED, by=len(records))

    stored = 0
    for record in records:
        try:
            body = json.loads(record["body"])
            item = {
                "pond_id": body["pond_id"],
                "metric_type_timestamp": _sort_key(body),
                "type": body["type"],
                "timestamp": body["timestamp"],
                "payload": {
                    k: v for k, v in body.items()
                    if k not in ("pond_id", "type", "timestamp")
                },
            }
            table.put_item(Item=to_decimal(item))
            stored += 1
        except Exception as exc:
            # One bad SQS record must never sink the rest of the batch.
            print(f"failed to process reading record: {exc}")
            continue

    if stored:
        counters.increment(COUNTERS_TABLE, counters.READINGS_STORED, by=stored)
