"""Unit tests for the zone_query Lambda covering status, history, and 404 paths."""
import json
from decimal import Decimal

import boto3
from moto import mock_aws

from conftest import import_handler

ADVISORY_TABLE = "AeroSenseAdvisoryEvents"


def _create_table(region: str) -> None:
    client = boto3.client("dynamodb", region_name=region)
    client.create_table(
        TableName=ADVISORY_TABLE,
        KeySchema=[
            {"AttributeName": "zone_id", "KeyType": "HASH"},
            {"AttributeName": "event_timestamp_sensor", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "zone_id", "AttributeType": "S"},
            {"AttributeName": "event_timestamp_sensor", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )


def _put(table, zone_id: str, sensor: str, timestamp: str, advisory_type: str, value: float):
    table.put_item(
        Item={
            "zone_id": zone_id,
            "event_timestamp_sensor": f"{timestamp}#{sensor}",
            "sensor": sensor,
            "advisory_type": advisory_type,
            "band": "moderate",
            "value": Decimal(str(value)),
            "details": {},
            "timestamp": timestamp,
        }
    )


def _status_event(zone_id: str) -> dict:
    return {
        "routeKey": "GET /zones/{zone_id}/status",
        "pathParameters": {"zone_id": zone_id},
    }


def _history_event(zone_id: str) -> dict:
    return {
        "routeKey": "GET /zones/{zone_id}/history",
        "pathParameters": {"zone_id": zone_id},
    }


def test_status_returns_latest_per_sensor():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("zone_query")
        table = handler_module.dynamodb.Table(ADVISORY_TABLE)

        _put(table, "zone-1", "pm25", "2026-07-02T09:00:00Z", "band_change", 20.0)
        _put(table, "zone-1", "pm25", "2026-07-02T10:00:00Z", "spike", 55.0)
        _put(table, "zone-1", "co2", "2026-07-02T09:30:00Z", "rate_of_rise", 900.0)

        response = handler_module.handler(_status_event("zone-1"), None)

        assert response["statusCode"] == 200
        assert response["headers"]["Access-Control-Allow-Origin"] == "*"
        body = json.loads(response["body"])
        sensors = {item["sensor"]: item for item in body["sensors"]}
        assert len(sensors) == 2
        assert sensors["pm25"]["timestamp"] == "2026-07-02T10:00:00Z"
        assert sensors["pm25"]["advisory_type"] == "spike"


def test_history_returns_all_raw_items():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("zone_query")
        table = handler_module.dynamodb.Table(ADVISORY_TABLE)

        _put(table, "zone-2", "co2", "2026-07-02T09:00:00Z", "rate_of_rise", 700.0)
        _put(table, "zone-2", "co2", "2026-07-02T10:00:00Z", "limit_exceeded", 1600.0)

        response = handler_module.handler(_history_event("zone-2"), None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert len(body["events"]) == 2


def test_unknown_zone_returns_404():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("zone_query")

        response = handler_module.handler(_status_event("no-such-zone"), None)

        assert response["statusCode"] == 404
