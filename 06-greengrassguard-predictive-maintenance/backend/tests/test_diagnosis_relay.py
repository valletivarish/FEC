"""Unit tests for the API Gateway-triggered diagnosis_relay Lambda."""
import json
import os

import boto3
from moto import mock_aws

from conftest import create_diagnosis_table, import_handler


def _queue_url(client) -> str:
    return client.create_queue(QueueName="guard-fault-intake-queue")["QueueUrl"]


def test_valid_body_is_relayed_to_queue_and_returns_202():
    with mock_aws():
        create_diagnosis_table()
        sqs = boto3.client("sqs")
        queue_url = _queue_url(sqs)
        os.environ["GUARD_INTAKE_QUEUE_URL"] = queue_url

        handler_module = import_handler("diagnosis_relay")
        event = {"body": json.dumps({"type": "vibe_fault", "asset_id": "asset-01"})}

        response = handler_module.handler(event, None)

        assert response["statusCode"] == 202
        messages = sqs.receive_message(QueueUrl=queue_url).get("Messages", [])
        assert len(messages) == 1
        assert json.loads(messages[0]["Body"])["asset_id"] == "asset-01"


def test_empty_body_returns_400_and_does_not_relay():
    with mock_aws():
        create_diagnosis_table()
        sqs = boto3.client("sqs")
        queue_url = _queue_url(sqs)
        os.environ["GUARD_INTAKE_QUEUE_URL"] = queue_url

        handler_module = import_handler("diagnosis_relay")
        response = handler_module.handler({"body": ""}, None)

        assert response["statusCode"] == 400
        messages = sqs.receive_message(QueueUrl=queue_url).get("Messages", [])
        assert messages == []


def test_relay_increments_messages_received_counter():
    with mock_aws():
        create_diagnosis_table()
        sqs = boto3.client("sqs")
        queue_url = _queue_url(sqs)
        os.environ["GUARD_INTAKE_QUEUE_URL"] = queue_url

        handler_module = import_handler("diagnosis_relay")
        from shared.ops_counters import read_counters

        handler_module.handler({"body": json.dumps({"type": "thermal_event"})}, None)
        handler_module.handler({"body": json.dumps({"type": "hydraulic_event"})}, None)

        assert read_counters()["messages_received"] == 2
