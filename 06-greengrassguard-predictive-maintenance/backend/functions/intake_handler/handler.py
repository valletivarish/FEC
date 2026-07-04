"""SQS-triggered Lambda that persists fog diagnosis events (vibe_fault, thermal_event, hydraulic_event)."""
import json
import os
from typing import Any

import boto3

from shared.json_encoder import to_decimal
from shared.ops_counters import STORED, increment

dynamodb = boto3.resource("dynamodb")


def _sort_key(body: dict[str, Any]) -> str:
    return f"{body['type']}#{body['timestamp']}"


def handler(event: dict[str, Any], context: Any) -> None:
    table = dynamodb.Table(os.environ["GUARD_DIAGNOSIS_TABLE"])

    for record in event.get("Records", []):
        try:
            body = json.loads(record["body"])
            item = {
                "asset_id": body["asset_id"],
                "event_type_timestamp": _sort_key(body),
                **{k: v for k, v in body.items() if k not in ("asset_id",)},
            }
            table.put_item(Item=to_decimal(item))
            increment(STORED)
        except Exception as exc:
            # A single malformed diagnosis must never sink the rest of the SQS batch.
            print(f"failed to process diagnosis record: {exc}")
            continue
