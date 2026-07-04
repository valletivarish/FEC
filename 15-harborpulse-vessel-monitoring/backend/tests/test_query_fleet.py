import json

import boto3
import pytest
from moto import mock_aws

ALARMS_TABLE = "harborpulse-alarms-table"
TELEMETRY_TABLE = "harborpulse-telemetry-table"


@pytest.fixture
def tables(monkeypatch):
    monkeypatch.setenv("HARBORPULSE_ALARMS_TABLE", ALARMS_TABLE)
    monkeypatch.setenv("HARBORPULSE_TELEMETRY_TABLE", TELEMETRY_TABLE)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
    with mock_aws():
        client = boto3.client("dynamodb", region_name="eu-west-1")
        client.create_table(
            TableName=ALARMS_TABLE,
            KeySchema=[
                {"AttributeName": "vesselId", "KeyType": "HASH"},
                {"AttributeName": "timestamp", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "vesselId", "AttributeType": "S"},
                {"AttributeName": "timestamp", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        client.create_table(
            TableName=TELEMETRY_TABLE,
            KeySchema=[
                {"AttributeName": "vesselId", "KeyType": "HASH"},
                {"AttributeName": "metricTypeTimestamp", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "vesselId", "AttributeType": "S"},
                {"AttributeName": "metricTypeTimestamp", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        client.put_item(
            TableName=ALARMS_TABLE,
            Item={
                "vesselId": {"S": "vessel-01"},
                "timestamp": {"S": "2026-07-03T11:00:00Z"},
                "payload": {"S": json.dumps({"alarmActive": True})},
            },
        )
        client.put_item(
            TableName=TELEMETRY_TABLE,
            Item={
                "vesselId": {"S": "vessel-01"},
                "metricTypeTimestamp": {"S": "engine_health_event#2026-07-03T10:00:00Z"},
                "payload": {"S": json.dumps({"rms": 1.0})},
            },
        )
        client.put_item(
            TableName=TELEMETRY_TABLE,
            Item={
                "vesselId": {"S": "vessel-02"},
                "metricTypeTimestamp": {"S": "sea_state_event#2026-07-03T10:01:00Z"},
                "payload": {"S": json.dumps({"seaStateClass": "CALM"})},
            },
        )
        yield client


def test_fleet_summary_returns_alarms_and_telemetry(tables):
    from backend.functions.query_fleet import handler as handler_module

    event = {"routeKey": "GET /fleet/summary"}
    result = handler_module.handler(event, None)

    assert result["statusCode"] == 200
    assert result["headers"]["Content-Type"] == "application/json"
    body = json.loads(result["body"])
    assert len(body["fleetAlarms"]) == 1
    assert len(body["telemetry"]) == 2


def test_vessel_telemetry_filters_by_vessel(tables):
    from backend.functions.query_fleet import handler as handler_module

    event = {
        "routeKey": "GET /vessels/{vesselId}/telemetry",
        "pathParameters": {"vesselId": "vessel-01"},
    }
    result = handler_module.handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert len(body) == 1
    assert body[0]["vesselId"] == "vessel-01"


def test_unknown_route_returns_404(tables):
    from backend.functions.query_fleet import handler as handler_module

    event = {"routeKey": "DELETE /nothing"}
    result = handler_module.handler(event, None)

    assert result["statusCode"] == 404
