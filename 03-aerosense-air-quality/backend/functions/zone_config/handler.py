"""API Gateway HTTP API v2 Lambda for reading and writing per-zone sensor config."""
import json
import os
from typing import Any

from shared.ddb import dynamodb, from_dynamo_item, to_dynamo_item

CONFIG_TABLE = os.environ.get("AEROSENSE_ZONE_CONFIG_TABLE", "AeroSenseZoneConfig")

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


def _handle_get(table: Any, zone_id: str) -> dict[str, Any]:
    result = table.get_item(Key={"zone_id": zone_id})
    item = result.get("Item")
    if item is None:
        return _response(404, {"message": f"no config found for zone {zone_id}"})
    return _response(200, from_dynamo_item(item))


def _handle_put(table: Any, zone_id: str, body_raw: str | None) -> dict[str, Any]:
    try:
        payload = json.loads(body_raw or "{}")
    except json.JSONDecodeError:
        return _response(400, {"message": "request body must be valid JSON"})

    payload["zone_id"] = zone_id
    table.put_item(Item=to_dynamo_item(payload))
    return _response(200, payload)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    route_key = event.get("routeKey", "")
    zone_id = event.get("pathParameters", {}).get("zone_id")

    if not zone_id:
        return _response(404, {"message": "zone_id is required"})

    table = dynamodb.Table(CONFIG_TABLE)

    if route_key.startswith("GET /config/{zone_id}"):
        return _handle_get(table, zone_id)

    if route_key.startswith("PUT /config/{zone_id}"):
        return _handle_put(table, zone_id, event.get("body"))

    return _response(404, {"message": f"unsupported route {route_key}"})
