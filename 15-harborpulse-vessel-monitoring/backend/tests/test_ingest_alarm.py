import json

import boto3
import pytest
from moto import mock_aws

TABLE_NAME = "harborpulse-alarms-table"


@pytest.fixture
def alarms_table(monkeypatch):
    monkeypatch.setenv("HARBORPULSE_ALARMS_TABLE", TABLE_NAME)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
    with mock_aws():
        client = boto3.client("dynamodb", region_name="eu-west-1")
        client.create_table(
            TableName=TABLE_NAME,
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
        yield client


def _sqs_record(body: dict) -> dict:
    return {"body": json.dumps(body)}


def test_active_alarm_has_no_ttl_attribute(alarms_table):
    from backend.functions.ingest_alarm import handler as handler_module

    event = {
        "Records": [
            _sqs_record(
                {
                    "type": "bilge_alarm",
                    "vesselId": "vessel-01",
                    "alarmActive": True,
                    "timestamp": "2026-07-03T11:00:00Z",
                }
            )
        ]
    }

    result = handler_module.handler(event, None)

    assert result["statusCode"] == 200
    item = alarms_table.get_item(
        TableName=TABLE_NAME,
        Key={"vesselId": {"S": "vessel-01"}, "timestamp": {"S": "2026-07-03T11:00:00Z"}},
    )["Item"]
    assert "ttlEpochSeconds" not in item


def test_resolved_alarm_gets_ttl_attribute(alarms_table):
    from backend.functions.ingest_alarm import handler as handler_module

    event = {
        "Records": [
            _sqs_record(
                {
                    "type": "bilge_alarm",
                    "vesselId": "vessel-01",
                    "alarmActive": False,
                    "timestamp": "2026-07-03T11:05:00Z",
                }
            )
        ]
    }

    handler_module.handler(event, None)

    item = alarms_table.get_item(
        TableName=TABLE_NAME,
        Key={"vesselId": {"S": "vessel-01"}, "timestamp": {"S": "2026-07-03T11:05:00Z"}},
    )["Item"]
    assert "ttlEpochSeconds" in item
    assert int(item["ttlEpochSeconds"]["N"]) > 0


def test_malformed_record_does_not_crash_batch(alarms_table):
    from backend.functions.ingest_alarm import handler as handler_module

    good = _sqs_record(
        {
            "type": "bilge_alarm",
            "vesselId": "vessel-02",
            "alarmActive": True,
            "timestamp": "2026-07-03T11:10:00Z",
        }
    )
    bad = {"body": "not json at all"}

    event = {"Records": [bad, good]}
    result = handler_module.handler(event, None)

    assert result["statusCode"] == 200
    item = alarms_table.get_item(
        TableName=TABLE_NAME,
        Key={"vesselId": {"S": "vessel-02"}, "timestamp": {"S": "2026-07-03T11:10:00Z"}},
    )["Item"]
    assert item is not None
