"""Unit tests for the SQS-triggered ingest_readings Lambda."""
import json

import boto3
from moto import mock_aws

from conftest import create_counters_table, import_handler

READINGS_TABLE = "AquaSentinelPondReadings"


def _create_table(region: str) -> None:
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


def test_writes_life_support_event_with_correct_sort_key():
    with mock_aws():
        _create_table("eu-west-1")
        create_counters_table("eu-west-1")
        handler_module = import_handler("ingest_readings")

        event_body = {
            "type": "life_support",
            "pond_id": "pond-01",
            "stage": "hypoxia_warning",
            "dissolved_oxygen": 3.8,
            "rate_of_change": -0.2,
            "timestamp": "2026-07-02T10:00:00Z",
        }
        event = {"Records": [{"body": json.dumps(event_body)}]}

        handler_module.handler(event, None)

        table = handler_module.dynamodb.Table(READINGS_TABLE)
        result = table.get_item(
            Key={
                "pond_id": "pond-01",
                "metric_type_timestamp": "life_support#2026-07-02T10:00:00Z",
            }
        )
        item = result["Item"]
        assert item["type"] == "life_support"
        assert item["payload"]["stage"] == "hypoxia_warning"
        assert float(item["payload"]["dissolved_oxygen"]) == 3.8


def test_writes_ops_feed_correlation_event_with_correct_sort_key():
    with mock_aws():
        _create_table("eu-west-1")
        create_counters_table("eu-west-1")
        handler_module = import_handler("ingest_readings")

        event_body = {
            "type": "ops_feed_correlation",
            "pond_id": "pond-02",
            "overfeeding_confidence": 0.75,
            "contributing_signals": ["feeder_trend", "ammonia_rising"],
            "timestamp": "2026-07-02T11:30:00Z",
        }
        event = {"Records": [{"body": json.dumps(event_body)}]}

        handler_module.handler(event, None)

        table = handler_module.dynamodb.Table(READINGS_TABLE)
        result = table.get_item(
            Key={
                "pond_id": "pond-02",
                "metric_type_timestamp": "ops_feed_correlation#2026-07-02T11:30:00Z",
            }
        )
        item = result["Item"]
        assert item["type"] == "ops_feed_correlation"
        assert float(item["payload"]["overfeeding_confidence"]) == 0.75
        assert item["payload"]["contributing_signals"] == ["feeder_trend", "ammonia_rising"]


def test_malformed_record_does_not_raise():
    with mock_aws():
        _create_table("eu-west-1")
        create_counters_table("eu-west-1")
        handler_module = import_handler("ingest_readings")

        event = {"Records": [{"body": "not valid json"}]}

        # Should not raise despite the malformed body.
        handler_module.handler(event, None)


def test_malformed_record_does_not_block_valid_ones_in_same_batch():
    with mock_aws():
        _create_table("eu-west-1")
        create_counters_table("eu-west-1")
        handler_module = import_handler("ingest_readings")

        good_event = {
            "type": "life_support",
            "pond_id": "pond-03",
            "stage": "cleared",
            "dissolved_oxygen": 5.5,
            "rate_of_change": 0.1,
            "timestamp": "2026-07-02T12:00:00Z",
        }
        event = {
            "Records": [
                {"body": "{broken"},
                {"body": json.dumps(good_event)},
            ]
        }

        handler_module.handler(event, None)

        table = handler_module.dynamodb.Table(READINGS_TABLE)
        result = table.get_item(
            Key={
                "pond_id": "pond-03",
                "metric_type_timestamp": "life_support#2026-07-02T12:00:00Z",
            }
        )
        assert "Item" in result
