"""Unit tests for the SQS-triggered intake_handler Lambda."""
import json
from decimal import Decimal

import boto3
from moto import mock_aws

from conftest import TABLE_NAME, create_diagnosis_table, import_handler


def _sqs_record(body: dict) -> dict:
    return {"body": json.dumps(body)}


def test_writes_vibe_fault_with_correct_sort_key():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("intake_handler")

        event = {
            "Records": [
                _sqs_record(
                    {
                        "type": "vibe_fault",
                        "asset_id": "asset-01",
                        "metric": "vibe-axial",
                        "fault_bands": [
                            {"band": "mid", "energy": 12.3, "anomaly_score": 4.1},
                        ],
                        "timestamp": "2026-07-02T10:00:00Z",
                    }
                )
            ]
        }

        handler_module.handler(event, None)

        table = boto3.resource("dynamodb").Table(TABLE_NAME)
        item = table.get_item(
            Key={
                "asset_id": "asset-01",
                "event_type_timestamp": "vibe_fault#2026-07-02T10:00:00Z",
            }
        )["Item"]
        assert item["metric"] == "vibe-axial"
        assert item["fault_bands"][0]["band"] == "mid"


def test_writes_thermal_event_with_correct_sort_key():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("intake_handler")

        event = {
            "Records": [
                _sqs_record(
                    {
                        "type": "thermal_event",
                        "asset_id": "asset-02",
                        "verdict_tags": ["runaway"],
                        "slope": 0.62,
                        "deviation": 3.1,
                        "timestamp": "2026-07-02T10:05:00Z",
                    }
                )
            ]
        }

        handler_module.handler(event, None)

        table = boto3.resource("dynamodb").Table(TABLE_NAME)
        item = table.get_item(
            Key={
                "asset_id": "asset-02",
                "event_type_timestamp": "thermal_event#2026-07-02T10:05:00Z",
            }
        )["Item"]
        assert item["verdict_tags"] == ["runaway"]


def test_writes_hydraulic_event_with_correct_sort_key():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("intake_handler")

        event = {
            "Records": [
                _sqs_record(
                    {
                        "type": "hydraulic_event",
                        "asset_id": "asset-03",
                        "efficiency": 0.42,
                        "cavitation_suspected": True,
                        "flow_cv": 0.21,
                        "pressure": 6.5,
                        "timestamp": "2026-07-02T10:10:00Z",
                    }
                )
            ]
        }

        handler_module.handler(event, None)

        table = boto3.resource("dynamodb").Table(TABLE_NAME)
        item = table.get_item(
            Key={
                "asset_id": "asset-03",
                "event_type_timestamp": "hydraulic_event#2026-07-02T10:10:00Z",
            }
        )["Item"]
        assert item["cavitation_suspected"] is True


def test_malformed_record_does_not_crash_batch():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("intake_handler")

        good_record = _sqs_record(
            {
                "type": "hydraulic_event",
                "asset_id": "asset-04",
                "efficiency": 0.3,
                "cavitation_suspected": False,
                "flow_cv": 0.05,
                "pressure": 9.0,
                "timestamp": "2026-07-02T10:15:00Z",
            }
        )
        malformed_record = {"body": "not-valid-json{{{"}

        event = {"Records": [malformed_record, good_record]}

        handler_module.handler(event, None)

        table = boto3.resource("dynamodb").Table(TABLE_NAME)
        item = table.get_item(
            Key={
                "asset_id": "asset-04",
                "event_type_timestamp": "hydraulic_event#2026-07-02T10:15:00Z",
            }
        )["Item"]
        assert item["efficiency"] == Decimal("0.3")


def test_missing_required_field_does_not_crash_batch():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("intake_handler")

        missing_asset_id = _sqs_record({"type": "vibe_fault", "timestamp": "2026-07-02T10:20:00Z"})

        event = {"Records": [missing_asset_id]}

        handler_module.handler(event, None)


def test_successful_writes_increment_messages_stored_counter():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("intake_handler")
        from shared.ops_counters import read_counters

        event = {
            "Records": [
                _sqs_record(
                    {
                        "type": "vibe_fault",
                        "asset_id": "asset-05",
                        "metric": "vibe-radial",
                        "fault_bands": [{"band": "high", "energy": 5.0, "anomaly_score": 4.0}],
                        "timestamp": "2026-07-02T10:25:00Z",
                    }
                ),
                _sqs_record(
                    {
                        "type": "hydraulic_event",
                        "asset_id": "asset-06",
                        "efficiency": 0.5,
                        "cavitation_suspected": False,
                        "flow_cv": 0.02,
                        "pressure": 8.0,
                        "timestamp": "2026-07-02T10:26:00Z",
                    }
                ),
            ]
        }

        handler_module.handler(event, None)

        assert read_counters()["messages_stored"] == 2


def test_malformed_record_does_not_increment_stored_counter():
    with mock_aws():
        create_diagnosis_table()
        handler_module = import_handler("intake_handler")
        from shared.ops_counters import read_counters

        event = {"Records": [{"body": "not-valid-json{{{"}]}
        handler_module.handler(event, None)

        assert read_counters()["messages_stored"] == 0
