"""Unit tests for the health_handler Lambda: real DynamoDB/SQS checks, no hardcoded status."""
import os

import boto3
from moto import mock_aws

from conftest import create_diagnosis_table, import_handler


def _queue_url(client) -> str:
    return client.create_queue(QueueName="guard-fault-intake-queue")["QueueUrl"]


def test_healthy_stack_returns_200_with_connected_statuses():
    with mock_aws():
        create_diagnosis_table()
        sqs = boto3.client("sqs")
        os.environ["GUARD_INTAKE_QUEUE_URL"] = _queue_url(sqs)

        handler_module = import_handler("health_handler")
        response = handler_module.handler({}, None)

        assert response["statusCode"] == 200
        import json
        body = json.loads(response["body"])
        assert body["database"]["status"] == "connected"
        assert body["queue"]["status"] == "connected"
        assert body["cloud_connection"] == "reachable"
        assert body["api_status"] == "reachable"
        assert body["server_status"] == "running"


def test_missing_table_reports_database_unavailable():
    with mock_aws():
        sqs = boto3.client("sqs")
        os.environ["GUARD_INTAKE_QUEUE_URL"] = _queue_url(sqs)
        os.environ["GUARD_DIAGNOSIS_TABLE"] = "TableThatDoesNotExist"

        handler_module = import_handler("health_handler")
        response = handler_module.handler({}, None)

        import json
        body = json.loads(response["body"])
        assert response["statusCode"] == 503
        assert body["database"]["status"] == "unavailable"

        os.environ["GUARD_DIAGNOSIS_TABLE"] = "GuardDiagnosisEvents"


def test_missing_queue_url_reports_queue_unavailable():
    with mock_aws():
        create_diagnosis_table()
        os.environ.pop("GUARD_INTAKE_QUEUE_URL", None)

        handler_module = import_handler("health_handler")
        response = handler_module.handler({}, None)

        import json
        body = json.loads(response["body"])
        assert response["statusCode"] == 503
        assert body["queue"]["status"] == "unavailable"


def test_health_reflects_live_message_counters():
    with mock_aws():
        create_diagnosis_table()
        sqs = boto3.client("sqs")
        os.environ["GUARD_INTAKE_QUEUE_URL"] = _queue_url(sqs)

        from shared.ops_counters import RECEIVED, STORED, increment
        increment(RECEIVED, 3)
        increment(STORED, 2)

        handler_module = import_handler("health_handler")
        response = handler_module.handler({}, None)

        import json
        body = json.loads(response["body"])
        assert body["messages_received"] == 3
        assert body["messages_stored"] == 2
