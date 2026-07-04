import json

import boto3
from moto import mock_aws

from conftest import import_handler

TABLE_NAME = "GreenGridReadings"
QUEUE_NAME = "greengrid-ingest-queue"


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


def _create_queue(region: str) -> str:
    client = boto3.client("sqs", region_name=region)
    return client.create_queue(QueueName=QUEUE_NAME)["QueueUrl"]


def test_reports_connected_database_and_queue_when_both_reachable(monkeypatch):
    with mock_aws():
        _create_table("eu-west-1")
        queue_url = _create_queue("eu-west-1")
        monkeypatch.setenv("GREENGRID_TARGET_QUEUE_URL", queue_url)

        handler_module = import_handler("status_handler")
        response = handler_module.handler({}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["database"]["status"] == "connected"
        assert body["queue"]["status"] == "connected"
        assert body["cloud_connection"] == "online"
        assert body["api_status"] == "reachable"
        assert body["server_status"] == "running"


def test_reports_degraded_when_queue_url_missing(monkeypatch):
    with mock_aws():
        _create_table("eu-west-1")
        monkeypatch.delenv("GREENGRID_TARGET_QUEUE_URL", raising=False)

        handler_module = import_handler("status_handler")
        response = handler_module.handler({}, None)

        body = json.loads(response["body"])
        assert body["queue"]["status"] == "unavailable"
        assert body["cloud_connection"] == "degraded"


def test_reports_unavailable_database_when_table_does_not_exist(monkeypatch):
    with mock_aws():
        # queue exists but the readings table was never created
        queue_url = _create_queue("eu-west-1")
        monkeypatch.setenv("GREENGRID_TARGET_QUEUE_URL", queue_url)

        handler_module = import_handler("status_handler")
        response = handler_module.handler({}, None)

        body = json.loads(response["body"])
        assert body["database"]["status"] == "unavailable"
        assert body["cloud_connection"] == "degraded"


def test_messages_received_reflects_real_ingest_counter(monkeypatch):
    with mock_aws():
        _create_table("eu-west-1")
        queue_url = _create_queue("eu-west-1")
        monkeypatch.setenv("GREENGRID_TARGET_QUEUE_URL", queue_url)
        monkeypatch.setenv("GREENGRID_READINGS_TABLE", TABLE_NAME)

        ingest_module = import_handler("ingest_handler")
        event = {
            "Records": [
                {"body": json.dumps({
                    "type": "weather_event",
                    "station_id": "station-quad",
                    "storm_risk_score": 82.5,
                    "mean_wind_speed": 12.3,
                    "mean_wind_direction": 210.0,
                    "barometric_slope": -1.2,
                    "timestamp": "2026-07-02T09:00:00Z",
                })}
            ]
        }
        ingest_module.handler(event, None)

        status_module = import_handler("status_handler")
        response = status_module.handler({}, None)
        body = json.loads(response["body"])

        assert body["messages_received"] == 1
        assert body["messages_stored"] == 1


def test_messages_received_is_zero_when_no_traffic_yet():
    with mock_aws():
        _create_table("eu-west-1")

        handler_module = import_handler("status_handler")
        response = handler_module.handler({}, None)
        body = json.loads(response["body"])

        assert body["messages_received"] == 0
        assert body["messages_stored"] == 0
