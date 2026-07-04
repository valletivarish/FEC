"""API Gateway HTTP API handler for GET /ponds/{pond_id}/status and GET /ponds/{pond_id}/alerts."""
import os
import re
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from shared.json_encoder import dumps

READINGS_TABLE = os.environ["AQUASENTINEL_READINGS_TABLE"]
ALERTS_TABLE = os.environ["AQUASENTINEL_ALERTS_TABLE"]

dynamodb = boto3.resource("dynamodb")


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {"statusCode": status, "body": dumps(body)}


def _as_payload_item(alert_item: dict[str, Any]) -> dict[str, Any]:
    # alerts rows are flat (severity/uia_mg_per_l/...); wrap them the same way ingest_readings
    # wraps readings rows, so the dashboard can read latest_readings[].payload uniformly
    payload = {k: v for k, v in alert_item.items() if k not in ("pond_id", "type", "timestamp")}
    return {"pond_id": alert_item.get("pond_id"), "type": alert_item.get("type"),
            "timestamp": alert_item.get("timestamp"), "payload": payload}


def _latest_status(pond_id: str) -> dict[str, Any]:
    # Sort key is type#timestamp, so the lexicographically last item per type is its latest reading.
    readings_table = dynamodb.Table(READINGS_TABLE)
    result = readings_table.query(
        KeyConditionExpression=Key("pond_id").eq(pond_id),
        ScanIndexForward=False,
        Limit=50,
    )
    items = result.get("Items", [])

    # urgent toxicity never lands in readings (the dispatcher routes it straight to /alerts),
    # so the alerts table is the only place its latest state can be found
    alerts_table = dynamodb.Table(ALERTS_TABLE)
    alert_result = alerts_table.query(
        KeyConditionExpression=Key("pond_id").eq(pond_id),
        ScanIndexForward=False,
        Limit=1,
    )
    alert_items = alert_result.get("Items", [])

    latest_by_type: dict[str, Any] = {}
    for item in items:
        event_type = item.get("type")
        if event_type not in latest_by_type:
            latest_by_type[event_type] = item
    for item in alert_items:
        event_type = item.get("type")
        existing = latest_by_type.get(event_type)
        if existing is None or item.get("timestamp", "") > existing.get("timestamp", ""):
            latest_by_type[event_type] = _as_payload_item(item)

    return {"pond_id": pond_id, "latest_readings": list(latest_by_type.values())}


def _recent_alerts(pond_id: str) -> dict[str, Any]:
    table = dynamodb.Table(ALERTS_TABLE)
    result = table.query(
        KeyConditionExpression=Key("pond_id").eq(pond_id),
        ScanIndexForward=False,
        Limit=20,
    )
    return {"pond_id": pond_id, "alerts": result.get("Items", [])}


_PATH_RE = re.compile(r"/ponds/(?P<pond_id>[^/]+)/(?:status|alerts)$")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    raw_path = event.get("rawPath", "") or event.get("path", "")

    # API Gateway routes populate pathParameters via its own route-template match. A Lambda
    # Function URL (the floci local-testing fallback, see infra/aquasentinel_stack.py) has no
    # route templates at all, so it never sets pathParameters -- parse pond_id out of rawPath
    # instead in that case. Real AWS always goes through the API Gateway branch above.
    path_params = event.get("pathParameters") or {}
    pond_id = path_params.get("pond_id")
    if not pond_id:
        match = _PATH_RE.search(raw_path)
        pond_id = match.group("pond_id") if match else None
    if not pond_id:
        return _response(400, {"error": "pond_id is required"})

    try:
        if raw_path.endswith("/alerts"):
            return _response(200, _recent_alerts(pond_id))
        return _response(200, _latest_status(pond_id))
    except Exception as exc:
        print(f"pond_query failed: {exc}")
        return _response(500, {"error": "internal error"})
