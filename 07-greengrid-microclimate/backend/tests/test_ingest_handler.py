import json

import boto3
from moto import mock_aws

from conftest import import_handler

TABLE_NAME = "GreenGridReadings"


def _create_table(region: str) -> None:
    client = boto3.client("dynamodb", region_name=region)
    client.create_table(
        TableName=TABLE_NAME,
        KeySchema=[
            {"AttributeName": "station_id", "KeyType": "HASH"},
            {"AttributeName": "event_type_timestamp", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "station_id", "AttributeType": "S"},
            {"AttributeName": "event_type_timestamp", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )


def _sqs_record(body: dict) -> dict:
    return {"body": json.dumps(body)}


WEATHER_EVENT = {
    "type": "weather_event",
    "station_id": "station-quad",
    "storm_risk_score": 82.5,
    "mean_wind_speed": 12.3,
    "mean_wind_direction": 210.0,
    "barometric_slope": -1.2,
    "timestamp": "2026-07-02T09:00:00Z",
}

SOIL_EVENT = {
    "type": "soil_event",
    "station_id": "station-north-lawn",
    "risk": "irrigation_need",
    "severity": None,
    "timestamp": "2026-07-02T09:05:00Z",
}

POLLUTION_EVENT = {
    "type": "pollution_event",
    "station_id": "station-arboretum",
    "metric": "pm2-5",
    "rolling_p95": 45.6,
    "exceedance_count": 6,
    "timestamp": "2026-07-02T09:10:00Z",
}


def test_writes_all_three_event_types_with_correct_sort_key():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("ingest_handler")

        event = {
            "Records": [
                _sqs_record(WEATHER_EVENT),
                _sqs_record(SOIL_EVENT),
                _sqs_record(POLLUTION_EVENT),
            ]
        }

        result = handler_module.handler(event, None)
        assert result == {"processed": 3, "failed": 0}

        table = handler_module.dynamodb.Table(TABLE_NAME)

        weather_item = table.get_item(
            Key={
                "station_id": "station-quad",
                "event_type_timestamp": "weather_event#2026-07-02T09:00:00Z",
            }
        )["Item"]
        assert weather_item["storm_risk_score"] == WEATHER_EVENT["storm_risk_score"]

        soil_item = table.get_item(
            Key={
                "station_id": "station-north-lawn",
                "event_type_timestamp": "soil_event#2026-07-02T09:05:00Z",
            }
        )["Item"]
        assert soil_item["risk"] == "irrigation_need"

        pollution_item = table.get_item(
            Key={
                "station_id": "station-arboretum",
                "event_type_timestamp": "pollution_event#2026-07-02T09:10:00Z",
            }
        )["Item"]
        assert pollution_item["metric"] == "pm2-5"


def test_malformed_record_does_not_crash_the_batch():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("ingest_handler")

        event = {
            "Records": [
                {"body": "not valid json"},
                _sqs_record(WEATHER_EVENT),
            ]
        }

        result = handler_module.handler(event, None)
        assert result == {"processed": 1, "failed": 1}

        table = handler_module.dynamodb.Table(TABLE_NAME)
        item = table.get_item(
            Key={
                "station_id": "station-quad",
                "event_type_timestamp": "weather_event#2026-07-02T09:00:00Z",
            }
        )["Item"]
        assert item["station_id"] == "station-quad"


def test_unknown_event_type_is_treated_as_malformed():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("ingest_handler")

        bad_event = dict(WEATHER_EVENT)
        bad_event["type"] = "mystery_event"

        event = {"Records": [_sqs_record(bad_event)]}
        result = handler_module.handler(event, None)
        assert result == {"processed": 0, "failed": 1}


def test_successful_batch_bumps_the_running_received_counter():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("ingest_handler")
        table = handler_module.dynamodb.Table(TABLE_NAME)

        event = {"Records": [_sqs_record(WEATHER_EVENT), _sqs_record(SOIL_EVENT)]}
        handler_module.handler(event, None)
        handler_module.handler({"Records": [_sqs_record(POLLUTION_EVENT)]}, None)

        counter = table.get_item(
            Key={"station_id": "__meta__", "event_type_timestamp": "counters#totals"}
        )["Item"]
        assert counter["messages_received"] == 3


def test_malformed_record_does_not_bump_the_received_counter():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("ingest_handler")
        table = handler_module.dynamodb.Table(TABLE_NAME)

        event = {"Records": [{"body": "not valid json"}]}
        handler_module.handler(event, None)

        counter = table.get_item(
            Key={"station_id": "__meta__", "event_type_timestamp": "counters#totals"}
        ).get("Item")
        assert counter is None
