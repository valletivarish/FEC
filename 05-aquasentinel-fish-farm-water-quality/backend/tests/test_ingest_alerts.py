"""Unit tests for the SQS-triggered ingest_alerts Lambda (higher-priority toxicity path)."""
import json

import boto3
from moto import mock_aws

from conftest import create_counters_table, import_handler

ALERTS_TABLE = "AquaSentinelPondAlerts"


def _create_table(region: str) -> None:
    client = boto3.client("dynamodb", region_name=region)
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


def test_writes_toxic_alert_with_provenance():
    with mock_aws():
        _create_table("eu-west-1")
        create_counters_table("eu-west-1")
        handler_module = import_handler("ingest_alerts")

        alert = {
            "type": "toxicity",
            "pond_id": "pond-01",
            "severity": "toxic",
            "uia_mg_per_l": 0.08,
            "nitrite_brown_blood_risk": False,
            "provenance": {
                "ph": 8.2,
                "water_temperature": 26.0,
                "salinity": 10.0,
                "pka": 9.1,
                "corrected_fraction": 0.09,
            },
            "timestamp": "2026-07-02T09:00:00Z",
        }
        event = {"Records": [{"body": json.dumps(alert)}]}

        handler_module.handler(event, None)

        table = handler_module.dynamodb.Table(ALERTS_TABLE)
        result = table.get_item(
            Key={"pond_id": "pond-01", "timestamp": "2026-07-02T09:00:00Z"}
        )
        item = result["Item"]
        assert item["severity"] == "toxic"
        assert float(item["uia_mg_per_l"]) == 0.08
        assert float(item["provenance"]["ph"]) == 8.2


def test_writes_brown_blood_risk_alert():
    with mock_aws():
        _create_table("eu-west-1")
        create_counters_table("eu-west-1")
        handler_module = import_handler("ingest_alerts")

        alert = {
            "type": "toxicity",
            "pond_id": "pond-02",
            "severity": "elevated",
            "uia_mg_per_l": 0.03,
            "nitrite_brown_blood_risk": True,
            "provenance": {
                "ph": 7.9,
                "water_temperature": 24.0,
                "salinity": 5.0,
                "pka": 9.2,
                "corrected_fraction": 0.03,
            },
            "timestamp": "2026-07-02T09:15:00Z",
        }
        event = {"Records": [{"body": json.dumps(alert)}]}

        handler_module.handler(event, None)

        table = handler_module.dynamodb.Table(ALERTS_TABLE)
        result = table.get_item(
            Key={"pond_id": "pond-02", "timestamp": "2026-07-02T09:15:00Z"}
        )
        assert result["Item"]["nitrite_brown_blood_risk"] is True


def test_malformed_record_does_not_raise():
    with mock_aws():
        _create_table("eu-west-1")
        create_counters_table("eu-west-1")
        handler_module = import_handler("ingest_alerts")

        event = {"Records": [{"body": "not valid json"}]}

        # Should not raise despite the malformed body.
        handler_module.handler(event, None)


def test_malformed_record_does_not_block_valid_ones_in_same_batch():
    with mock_aws():
        _create_table("eu-west-1")
        create_counters_table("eu-west-1")
        handler_module = import_handler("ingest_alerts")

        good_alert = {
            "type": "toxicity",
            "pond_id": "pond-03",
            "severity": "toxic",
            "uia_mg_per_l": 0.11,
            "nitrite_brown_blood_risk": False,
            "provenance": {
                "ph": 8.5,
                "water_temperature": 29.0,
                "salinity": 0.0,
                "pka": 8.9,
                "corrected_fraction": 0.12,
            },
            "timestamp": "2026-07-02T09:30:00Z",
        }
        event = {
            "Records": [
                {"body": "{broken"},
                {"body": json.dumps(good_alert)},
            ]
        }

        handler_module.handler(event, None)

        table = handler_module.dynamodb.Table(ALERTS_TABLE)
        result = table.get_item(
            Key={"pond_id": "pond-03", "timestamp": "2026-07-02T09:30:00Z"}
        )
        assert "Item" in result
