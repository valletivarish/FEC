"""SQS-triggered Lambda for the higher-priority alerts queue (toxic / brown-blood-risk events)."""
import json
import os
from typing import Any

import boto3

from shared import counters
from shared.json_encoder import to_decimal

ALERTS_TABLE = os.environ["AQUASENTINEL_ALERTS_TABLE"]
COUNTERS_TABLE = os.environ.get("AQUASENTINEL_COUNTERS_TABLE", counters.COUNTERS_TABLE)

dynamodb = boto3.resource("dynamodb")


def handler(event: dict[str, Any], context: Any) -> None:
    table = dynamodb.Table(ALERTS_TABLE)
    records = event.get("Records", [])
    if records:
        counters.increment(COUNTERS_TABLE, counters.ALERTS_RECEIVED, by=len(records))

    stored = 0
    for record in records:
        try:
            body = json.loads(record["body"])
            item = {
                "pond_id": body["pond_id"],
                "timestamp": body["timestamp"],
                "type": body["type"],
                "severity": body.get("severity"),
                "uia_mg_per_l": body.get("uia_mg_per_l"),
                "nitrite_brown_blood_risk": body.get("nitrite_brown_blood_risk", False),
                "provenance": body.get("provenance", {}),
            }
            table.put_item(Item=to_decimal(item))
            stored += 1
        except Exception as exc:
            # Alerts are higher priority than readings, but a malformed one still can't crash the batch.
            print(f"failed to process alert record: {exc}")
            continue

    if stored:
        counters.increment(COUNTERS_TABLE, counters.ALERTS_STORED, by=stored)
