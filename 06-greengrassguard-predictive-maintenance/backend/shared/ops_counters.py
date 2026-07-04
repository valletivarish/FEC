"""Atomic running counters persisted in DynamoDB, so restart/cold-start never loses history.

One item per counter (partition key COUNTER_ID) in the diagnosis table itself — a dedicated
table would double infra for two integers, and the sort key namespace already isolates event
rows (type#timestamp) from a counter row (a fixed literal) with no collision risk.
"""
import os
from typing import Any

import boto3

COUNTER_PARTITION_ID = "__ops_counters__"
COUNTER_SORT_KEY = "counters"

RECEIVED = "messages_received"
STORED = "messages_stored"


def _table():
    dynamodb = boto3.resource("dynamodb")
    return dynamodb.Table(os.environ["GUARD_DIAGNOSIS_TABLE"])


def increment(counter_name: str, by: int = 1) -> None:
    """Best-effort: a counter miss must never break the intake/relay path it's attached to."""
    try:
        _table().update_item(
            Key={"asset_id": COUNTER_PARTITION_ID, "event_type_timestamp": COUNTER_SORT_KEY},
            UpdateExpression="ADD #c :inc",
            ExpressionAttributeNames={"#c": counter_name},
            ExpressionAttributeValues={":inc": by},
        )
    except Exception as exc:
        print(f"failed to increment counter {counter_name}: {exc}")


def read_counters() -> dict[str, Any]:
    try:
        item = _table().get_item(
            Key={"asset_id": COUNTER_PARTITION_ID, "event_type_timestamp": COUNTER_SORT_KEY}
        ).get("Item", {})
    except Exception as exc:
        print(f"failed to read counters: {exc}")
        return {RECEIVED: 0, STORED: 0}

    return {
        RECEIVED: int(item.get(RECEIVED, 0)),
        STORED: int(item.get(STORED, 0)),
    }
