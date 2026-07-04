import json

import boto3
import pytest
from moto import mock_aws

TABLE_NAME = "harborpulse-telemetry-table"


@pytest.fixture
def telemetry_table(monkeypatch):
    monkeypatch.setenv("HARBORPULSE_TELEMETRY_TABLE", TABLE_NAME)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
    with mock_aws():
        client = boto3.client("dynamodb", region_name="eu-west-1")
        client.create_table(
            TableName=TABLE_NAME,
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
        yield client


def _sqs_record(body: dict) -> dict:
    return {"body": json.dumps(body)}


def test_writes_item_with_correct_keys(telemetry_table):
    from backend.functions.ingest_telemetry import handler as handler_module

    event = {
        "Records": [
            _sqs_record(
                {
                    "type": "engine_health_event",
                    "vesselId": "vessel-01",
                    "rms": 1.2,
                    "bearingWearEnergy": 0.5,
                    "degradedBearing": False,
                    "engineRpm": 1800,
                    "coolantTempC": 75.0,
                    "oilPressureKpa": 400.0,
                    "fuelFlowLph": 12.0,
                    "timestamp": "2026-07-03T10:00:00Z",
                }
            )
        ]
    }

    result = handler_module.handler(event, None)

    assert result["statusCode"] == 200
    item = telemetry_table.get_item(
        TableName=TABLE_NAME,
        Key={
            "vesselId": {"S": "vessel-01"},
            "metricTypeTimestamp": {"S": "engine_health_event#2026-07-03T10:00:00Z"},
        },
    )["Item"]
    payload = json.loads(item["payload"]["S"])
    assert payload["rms"] == 1.2
    assert payload["degradedBearing"] is False


def test_malformed_record_does_not_crash_batch(telemetry_table):
    from backend.functions.ingest_telemetry import handler as handler_module

    good = _sqs_record(
        {
            "type": "sea_state_event",
            "vesselId": "vessel-02",
            "seaStateClass": "CALM",
            "rollAmplitudeDeg": 2.0,
            "rollPeriodEstimate": 4.0,
            "meanWindSpeedKn": 5.0,
            "timestamp": "2026-07-03T10:05:00Z",
        }
    )
    bad = {"body": "{not valid json"}

    event = {"Records": [bad, good]}
    result = handler_module.handler(event, None)

    assert result["statusCode"] == 200
    item = telemetry_table.get_item(
        TableName=TABLE_NAME,
        Key={
            "vesselId": {"S": "vessel-02"},
            "metricTypeTimestamp": {"S": "sea_state_event#2026-07-03T10:05:00Z"},
        },
    )["Item"]
    assert item is not None


def test_gps_track_event_key_shape(telemetry_table):
    from backend.functions.ingest_telemetry import handler as handler_module

    event = {
        "Records": [
            _sqs_record(
                {
                    "type": "gps_track_event",
                    "vesselId": "vessel-03",
                    "lat": 53.35,
                    "lon": -6.26,
                    "headingDeg": 180,
                    "timestamp": "2026-07-03T10:10:00Z",
                }
            )
        ]
    }

    handler_module.handler(event, None)

    item = telemetry_table.get_item(
        TableName=TABLE_NAME,
        Key={
            "vesselId": {"S": "vessel-03"},
            "metricTypeTimestamp": {"S": "gps_track_event#2026-07-03T10:10:00Z"},
        },
    )["Item"]
    payload = json.loads(item["payload"]["S"])
    assert payload["lat"] == 53.35
