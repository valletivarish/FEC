"""Unit tests for the system_metrics API Gateway handler -- real counters and real item counts."""
import json

import boto3
from moto import mock_aws

from conftest import import_handler

READINGS_TABLE = "AquaSentinelPondReadings"
ALERTS_TABLE = "AquaSentinelPondAlerts"
COUNTERS_TABLE = "AquaSentinelSystemCounters"


def _create_tables(region: str) -> None:
    client = boto3.client("dynamodb", region_name=region)
    client.create_table(
        TableName=READINGS_TABLE,
        KeySchema=[
            {"AttributeName": "pond_id", "KeyType": "HASH"},
            {"AttributeName": "metric_type_timestamp", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "pond_id", "AttributeType": "S"},
            {"AttributeName": "metric_type_timestamp", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    client.create_table(
        TableName=ALERTS_TABLE,
        KeySchema=[
            {"AttributeName": "pond_id", "KeyType": "HASH"},
            {"AttributeName": "timestamp", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "pond_id", "AttributeType": "S"},
            {"AttributeName": "timestamp", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    client.create_table(
        TableName=COUNTERS_TABLE,
        KeySchema=[{"AttributeName": "counter_name", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "counter_name", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )


def test_metrics_reports_zero_when_nothing_has_happened_yet():
    with mock_aws():
        _create_tables("eu-west-1")
        handler_module = import_handler("system_metrics")

        response = handler_module.handler({}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["messages_received_total"] == 0
        assert body["messages_stored_total"] == 0


def test_metrics_reflects_real_ingest_handler_activity():
    with mock_aws():
        _create_tables("eu-west-1")
        ingest_readings = import_handler("ingest_readings")
        ingest_alerts = import_handler("ingest_alerts")

        readings_event = {
            "Records": [
                {"body": json.dumps({"type": "life_support", "pond_id": "pond-01", "stage": "cleared", "timestamp": "2026-07-02T10:00:00Z"})},
                {"body": json.dumps({"type": "life_support", "pond_id": "pond-02", "stage": "cleared", "timestamp": "2026-07-02T10:01:00Z"})},
            ]
        }
        ingest_readings.handler(readings_event, None)

        alerts_event = {
            "Records": [
                {"body": json.dumps({"type": "toxicity", "pond_id": "pond-01", "severity": "toxic", "timestamp": "2026-07-02T10:02:00Z"})},
            ]
        }
        ingest_alerts.handler(alerts_event, None)

        handler_module = import_handler("system_metrics")
        response = handler_module.handler({}, None)
        body = json.loads(response["body"])

        assert body["readings_received_total"] == 2
        assert body["readings_stored_total"] == 2
        assert body["alerts_received_total"] == 1
        assert body["alerts_stored_total"] == 1
        assert body["messages_received_total"] == 3
        assert body["messages_stored_total"] == 3


def test_metrics_does_not_count_malformed_records_as_stored():
    with mock_aws():
        _create_tables("eu-west-1")
        ingest_readings = import_handler("ingest_readings")

        event = {"Records": [{"body": "not valid json"}, {"body": json.dumps({
            "type": "life_support", "pond_id": "pond-01", "stage": "cleared", "timestamp": "2026-07-02T10:00:00Z",
        })}]}
        ingest_readings.handler(event, None)

        handler_module = import_handler("system_metrics")
        response = handler_module.handler({}, None)
        body = json.loads(response["body"])

        # both records were received, but only the well-formed one was actually stored
        assert body["readings_received_total"] == 2
        assert body["readings_stored_total"] == 1
