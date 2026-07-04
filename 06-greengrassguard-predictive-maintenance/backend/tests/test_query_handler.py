"""Unit tests for the API Gateway-triggered query_handler Lambda."""
import json
from decimal import Decimal

import boto3
from moto import mock_aws

from conftest import TABLE_NAME, create_diagnosis_table, import_handler


def _seed(table, asset_id: str, event_type: str, timestamp: str, **extra):
    item = {
        "asset_id": asset_id,
        "event_type_timestamp": f"{event_type}#{timestamp}",
        "type": event_type,
        "timestamp": timestamp,
        **extra,
    }
    table.put_item(Item=item)


def test_returns_200_with_seeded_diagnoses():
    with mock_aws():
        create_diagnosis_table()
        table = boto3.resource("dynamodb").Table(TABLE_NAME)
        _seed(
            table,
            "asset-01",
            "vibe_fault",
            "2026-07-02T10:00:00Z",
            fault_bands=[{"band": "high", "energy": Decimal("18.75"), "anomaly_score": Decimal("4.2")}],
        )
        _seed(
            table,
            "asset-01",
            "thermal_event",
            "2026-07-02T10:05:00Z",
            slope=Decimal("0.61"),
            deviation=Decimal("9.4"),
            verdict_tags=["sideband"],
        )

        handler_module = import_handler("query_handler")
        response = handler_module.handler({"pathParameters": {"asset_id": "asset-01"}}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["asset_id"] == "asset-01"
        assert len(body["diagnoses"]) == 2


def test_decimal_numbers_are_json_encodable():
    with mock_aws():
        create_diagnosis_table()
        table = boto3.resource("dynamodb").Table(TABLE_NAME)
        _seed(
            table,
            "asset-02",
            "hydraulic_event",
            "2026-07-02T10:10:00Z",
            efficiency=Decimal("0.47"),
            cavitation_suspected=True,
            flow_cv=Decimal("0.18"),
            pressure=Decimal("6.9"),
        )

        handler_module = import_handler("query_handler")
        response = handler_module.handler({"pathParameters": {"asset_id": "asset-02"}}, None)
        body = json.loads(response["body"])

        diag = body["diagnoses"][0]
        assert diag["efficiency"] == 0.47
        assert diag["pressure"] == 6.9
        assert isinstance(diag["efficiency"], float)


def test_missing_asset_id_returns_400():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("query_handler")
        response = handler_module.handler({"pathParameters": {}}, None)
        assert response["statusCode"] == 400


def test_unknown_asset_id_returns_empty_list():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("query_handler")
        response = handler_module.handler({"pathParameters": {"asset_id": "asset-99"}}, None)
        body = json.loads(response["body"])
        assert response["statusCode"] == 200
        assert body["diagnoses"] == []
