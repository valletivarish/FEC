import json
import os

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")


def _response(status_code: int, body) -> dict:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _fleet_summary() -> dict:
    alarms_table = dynamodb.Table(os.environ["HARBORPULSE_ALARMS_TABLE"])
    telemetry_table = dynamodb.Table(os.environ["HARBORPULSE_TELEMETRY_TABLE"])

    alarms_items = []
    scan_kwargs = {}
    while True:
        page = alarms_table.scan(**scan_kwargs)
        alarms_items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    telemetry_items = []
    scan_kwargs = {}
    while True:
        page = telemetry_table.scan(**scan_kwargs)
        telemetry_items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    return {"fleetAlarms": alarms_items, "telemetry": telemetry_items}


def _vessel_telemetry(vessel_id: str) -> list:
    telemetry_table = dynamodb.Table(os.environ["HARBORPULSE_TELEMETRY_TABLE"])

    items = []
    query_kwargs = {"KeyConditionExpression": Key("vesselId").eq(vessel_id)}
    while True:
        page = telemetry_table.query(**query_kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        query_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    return items


def handler(event, context):
    route_key = event.get("routeKey")

    if route_key == "GET /fleet/summary":
        return _response(200, _fleet_summary())

    if route_key == "GET /vessels/{vesselId}/telemetry":
        vessel_id = event.get("pathParameters", {}).get("vesselId")
        return _response(200, _vessel_telemetry(vessel_id))

    return _response(404, {"message": "not found"})
