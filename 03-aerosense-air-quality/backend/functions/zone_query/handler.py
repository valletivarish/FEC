"""API Gateway HTTP API v2 Lambda serving zone status and history reads."""
import json
import os
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.ddb import dynamodb, from_dynamo_item

ADVISORY_TABLE = os.environ.get("AEROSENSE_ADVISORY_TABLE", "AeroSenseAdvisoryEvents")
QUERY_LIMIT = 200

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
}


def _response(status_code: int, body: Any) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def _latest_per_sensor(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Items arrive sorted by sort key, so the last item seen per sensor is the newest."""
    latest: dict[str, dict[str, Any]] = {}
    for item in items:
        latest[item["sensor"]] = item
    return list(latest.values())


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    route_key = event.get("routeKey", "")
    zone_id = event.get("pathParameters", {}).get("zone_id")

    if not zone_id:
        return _response(404, {"message": "zone_id is required"})

    table = dynamodb.Table(ADVISORY_TABLE)
    result = table.query(
        KeyConditionExpression=Key("zone_id").eq(zone_id),
        ScanIndexForward=True,
        Limit=QUERY_LIMIT,
    )
    items = [from_dynamo_item(item) for item in result.get("Items", [])]

    if not items:
        return _response(404, {"message": f"no data found for zone {zone_id}"})

    if route_key.startswith("GET /zones/{zone_id}/status"):
        return _response(200, {"zone_id": zone_id, "sensors": _latest_per_sensor(items)})

    if route_key.startswith("GET /zones/{zone_id}/history"):
        return _response(200, {"zone_id": zone_id, "events": items})

    return _response(404, {"message": f"unsupported route {route_key}"})
