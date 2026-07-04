"""Unit tests for the SQS-triggered advisory_ingest Lambda."""
import json

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


def test_writes_valid_advisory_to_dynamodb():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("advisory_ingest")

        advisory = {
            "zone_id": "zone-1",
            "sensor": "pm25",
            "advisory_type": "band_change",
            "band": "moderate",
            "value": 42.5,
            "details": {"previous_band": "good"},
            "timestamp": "2026-07-02T10:00:00Z",
        }
        event = {"Records": [{"body": json.dumps(advisory)}]}

        handler_module.handler(event, None)

        table = handler_module.dynamodb.Table(ADVISORY_TABLE)
        result = table.get_item(
            Key={"zone_id": "zone-1", "event_timestamp_sensor": "2026-07-02T10:00:00Z#pm25"}
        )
        item = result["Item"]
        assert item["sensor"] == "pm25"
        assert item["advisory_type"] == "band_change"
        assert float(item["value"]) == 42.5


def test_malformed_record_does_not_raise():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("advisory_ingest")

        event = {"Records": [{"body": "not valid json"}]}

        # Should not raise despite the malformed body.
        handler_module.handler(event, None)


def test_malformed_record_does_not_block_valid_ones_in_same_batch():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("advisory_ingest")

        good_advisory = {
            "zone_id": "zone-2",
            "sensor": "co2",
            "advisory_type": "limit_exceeded",
            "band": None,
            "value": 1500.0,
            "details": {},
            "timestamp": "2026-07-02T11:00:00Z",
        }
        event = {
            "Records": [
                {"body": "{broken"},
                {"body": json.dumps(good_advisory)},
            ]
        }

        handler_module.handler(event, None)

        table = handler_module.dynamodb.Table(ADVISORY_TABLE)
        result = table.get_item(
            Key={"zone_id": "zone-2", "event_timestamp_sensor": "2026-07-02T11:00:00Z#co2"}
        )
        assert "Item" in result
