"""SQS-triggered Lambda that persists fog-generated advisories into DynamoDB."""
import json
import os
from typing import Any

from shared.ddb import dynamodb, to_dynamo_item

ADVISORY_TABLE = os.environ.get("AEROSENSE_ADVISORY_TABLE", "AeroSenseAdvisoryEvents")


def _build_sort_key(advisory: dict[str, Any]) -> str:
    """Sort key must stay unique per timestamp+sensor so repeat advisories don't overwrite."""
    return f"{advisory['timestamp']}#{advisory['sensor']}"


def handler(event: dict[str, Any], context: Any) -> None:
    table = dynamodb.Table(ADVISORY_TABLE)

    for record in event.get("Records", []):
        try:
            advisory = json.loads(record["body"])
            item = {
                "zone_id": advisory["zone_id"],
                "event_timestamp_sensor": _build_sort_key(advisory),
                "sensor": advisory["sensor"],
                "advisory_type": advisory["advisory_type"],
                "band": advisory.get("band"),
                "value": advisory.get("value"),
                "details": advisory.get("details", {}),
                "timestamp": advisory["timestamp"],
            }
            table.put_item(Item=to_dynamo_item(item))
        except Exception as exc:
            # A single bad record must not sink the whole SQS batch, so log and move on.
            print(f"failed to process advisory record: {exc}")
            continue
