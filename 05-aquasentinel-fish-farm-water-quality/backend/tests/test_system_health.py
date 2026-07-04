"""Unit tests for the system_health API Gateway handler -- real DynamoDB/SQS checks, not hardcoded strings."""
import json

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


def _create_queues(region: str) -> tuple[str, str]:
    client = boto3.client("sqs", region_name=region)
    readings_url = client.create_queue(QueueName="aquasentinel-readings-queue")["QueueUrl"]
    alerts_url = client.create_queue(QueueName="aquasentinel-alerts-queue")["QueueUrl"]
    return readings_url, alerts_url


def _set_queue_env(monkeypatch, readings_url: str, alerts_url: str) -> None:
    monkeypatch.setenv("AQUASENTINEL_READINGS_QUEUE_URL", readings_url)
    monkeypatch.setenv("AQUASENTINEL_ALERTS_QUEUE_URL", alerts_url)


def test_health_reports_connected_when_tables_and_queues_are_reachable(monkeypatch):
    with mock_aws():
        _create_tables("eu-west-1")
        readings_url, alerts_url = _create_queues("eu-west-1")
        _set_queue_env(monkeypatch, readings_url, alerts_url)
        handler_module = import_handler("system_health")

        response = handler_module.handler({}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["database_status"] == "connected"
        assert body["queue_status"] == "connected"
        assert body["cloud_connection"] == "connected"
        assert body["api_status"] == "reachable"
        assert body["server_status"] == "running"


def test_health_reports_unavailable_when_a_queue_url_is_bogus(monkeypatch):
    with mock_aws():
        _create_tables("eu-west-1")
        readings_url, _ = _create_queues("eu-west-1")
        _set_queue_env(monkeypatch, readings_url, "https://sqs.eu-west-1.amazonaws.com/000000000000/does-not-exist")
        handler_module = import_handler("system_health")

        response = handler_module.handler({}, None)

        assert response["statusCode"] == 503
        body = json.loads(response["body"])
        assert body["queue_status"] == "unavailable"
        assert body["cloud_connection"] == "unreachable"


def test_health_includes_per_table_and_per_queue_detail(monkeypatch):
    with mock_aws():
        _create_tables("eu-west-1")
        readings_url, alerts_url = _create_queues("eu-west-1")
        _set_queue_env(monkeypatch, readings_url, alerts_url)
        handler_module = import_handler("system_health")

        response = handler_module.handler({}, None)
        body = json.loads(response["body"])

        assert len(body["tables"]) == 2
        assert all(t["status"] == "connected" for t in body["tables"])
        assert len(body["queues"]) == 2
        assert all(q["status"] == "connected" for q in body["queues"])
        assert all("approximate_messages" in q for q in body["queues"])
