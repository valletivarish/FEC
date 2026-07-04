"""Unit tests for the zone_config Lambda covering GET and PUT paths."""
import json

import boto3
from moto import mock_aws

from conftest import import_handler

CONFIG_TABLE = "AeroSenseZoneConfig"


def _create_table(region: str) -> None:
    client = boto3.client("dynamodb", region_name=region)
    client.create_table(
        TableName=CONFIG_TABLE,
        KeySchema=[{"AttributeName": "zone_id", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "zone_id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )


def _get_event(zone_id: str) -> dict:
    return {
        "routeKey": "GET /config/{zone_id}",
        "pathParameters": {"zone_id": zone_id},
    }


def _put_event(zone_id: str, body: dict) -> dict:
    return {
        "routeKey": "PUT /config/{zone_id}",
        "pathParameters": {"zone_id": zone_id},
        "body": json.dumps(body),
    }


def test_get_returns_404_when_absent():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("zone_config")

        response = handler_module.handler(_get_event("zone-1"), None)

        assert response["statusCode"] == 404
        assert response["headers"]["Access-Control-Allow-Origin"] == "*"


def test_put_then_get_round_trips_config():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("zone_config")

        config = {
            "sensors": {
                "co2": {"frequency_s": 30, "dispatch_rate": "on_change"},
                "pm25": {"frequency_s": 15, "dispatch_rate": "always"},
            }
        }
        put_response = handler_module.handler(_put_event("zone-1", config), None)
        assert put_response["statusCode"] == 200

        get_response = handler_module.handler(_get_event("zone-1"), None)
        assert get_response["statusCode"] == 200
        body = json.loads(get_response["body"])
        assert body["zone_id"] == "zone-1"
        assert body["sensors"]["co2"]["frequency_s"] == 30
