"""Unit tests for the pond_query API Gateway handler."""
import json
from decimal import Decimal

import boto3
from moto import mock_aws

from conftest import import_handler

READINGS_TABLE = "AquaSentinelPondReadings"
ALERTS_TABLE = "AquaSentinelPondAlerts"


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


def _seed(handler_module) -> None:
    readings = handler_module.dynamodb.Table(READINGS_TABLE)
    readings.put_item(Item={
        "pond_id": "pond-01",
        "metric_type_timestamp": "life_support#2026-07-02T09:00:00Z",
        "type": "life_support",
        "timestamp": "2026-07-02T09:00:00Z",
        "payload": {"dissolved_oxygen": Decimal("3.9"), "stage": "hypoxia_warning"},
    })
    readings.put_item(Item={
        "pond_id": "pond-01",
        "metric_type_timestamp": "life_support#2026-07-02T10:00:00Z",
        "type": "life_support",
        "timestamp": "2026-07-02T10:00:00Z",
        "payload": {"dissolved_oxygen": Decimal("3.5"), "stage": "hypoxia_critical"},
    })

    alerts = handler_module.dynamodb.Table(ALERTS_TABLE)
    alerts.put_item(Item={
        "pond_id": "pond-01",
        "timestamp": "2026-07-02T09:05:00Z",
        "type": "toxicity",
        "severity": "toxic",
        "uia_mg_per_l": Decimal("0.09"),
        "nitrite_brown_blood_risk": False,
        "provenance": {"ph": Decimal("8.3")},
    })


def test_status_returns_latest_reading_per_type():
    with mock_aws():
        _create_tables("eu-west-1")
        handler_module = import_handler("pond_query")
        _seed(handler_module)

        event = {
            "rawPath": "/ponds/pond-01/status",
            "pathParameters": {"pond_id": "pond-01"},
        }
        response = handler_module.handler(event, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["pond_id"] == "pond-01"
        # one life_support item (2 seeded, latest wins) plus the seeded toxicity alert merged in
        types = {item["type"] for item in body["latest_readings"]}
        assert types == {"life_support", "toxicity"}
        life_support = next(i for i in body["latest_readings"] if i["type"] == "life_support")
        assert life_support["payload"]["dissolved_oxygen"] == 3.5
        assert isinstance(life_support["payload"]["dissolved_oxygen"], float)


def test_status_merges_urgent_toxicity_from_alerts_table():
    # urgent toxicity never lands in the readings table -- the dispatcher sends it straight
    # to /alerts -- so /status must pull it in from there to genuinely reflect the latest state
    with mock_aws():
        _create_tables("eu-west-1")
        handler_module = import_handler("pond_query")
        _seed(handler_module)

        event = {
            "rawPath": "/ponds/pond-01/status",
            "pathParameters": {"pond_id": "pond-01"},
        }
        response = handler_module.handler(event, None)
        body = json.loads(response["body"])

        toxicity = next(i for i in body["latest_readings"] if i["type"] == "toxicity")
        assert toxicity["payload"]["severity"] == "toxic"
        assert toxicity["payload"]["uia_mg_per_l"] == 0.09
        assert toxicity["payload"]["provenance"]["ph"] == 8.3


def test_status_prefers_newer_readings_item_over_older_alert():
    with mock_aws():
        _create_tables("eu-west-1")
        handler_module = import_handler("pond_query")
        readings = handler_module.dynamodb.Table(READINGS_TABLE)
        readings.put_item(Item={
            "pond_id": "pond-02",
            "metric_type_timestamp": "toxicity#2026-07-02T12:00:00Z",
            "type": "toxicity",
            "timestamp": "2026-07-02T12:00:00Z",
            "payload": {"severity": "safe", "uia_mg_per_l": Decimal("0.01")},
        })
        alerts = handler_module.dynamodb.Table(ALERTS_TABLE)
        alerts.put_item(Item={
            "pond_id": "pond-02",
            "timestamp": "2026-07-02T09:00:00Z",
            "type": "toxicity",
            "severity": "toxic",
            "uia_mg_per_l": Decimal("0.09"),
        })

        event = {
            "rawPath": "/ponds/pond-02/status",
            "pathParameters": {"pond_id": "pond-02"},
        }
        response = handler_module.handler(event, None)
        body = json.loads(response["body"])

        toxicity = next(i for i in body["latest_readings"] if i["type"] == "toxicity")
        assert toxicity["payload"]["severity"] == "safe"


def test_alerts_returns_recent_alerts_decimal_safe():
    with mock_aws():
        _create_tables("eu-west-1")
        handler_module = import_handler("pond_query")
        _seed(handler_module)

        event = {
            "rawPath": "/ponds/pond-01/alerts",
            "pathParameters": {"pond_id": "pond-01"},
        }
        response = handler_module.handler(event, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert len(body["alerts"]) == 1
        assert body["alerts"][0]["uia_mg_per_l"] == 0.09
        assert body["alerts"][0]["provenance"]["ph"] == 8.3


def test_missing_pond_id_returns_400():
    with mock_aws():
        _create_tables("eu-west-1")
        handler_module = import_handler("pond_query")

        event = {"rawPath": "/ponds//status", "pathParameters": {}}
        response = handler_module.handler(event, None)

        assert response["statusCode"] == 400
