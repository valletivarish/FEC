"""Proves the API Gateway relay path is real: a POST-shaped event reaches SQS via the
relay Lambda, closing the gap where only the queue's Lambda event source was wired.
"""
import json
import os
import socket
import urllib.parse

import boto3
import pytest

QUEUE_NAME = "guard-diagnosis-relay-it-queue"


def _emulator_reachable() -> bool:
    endpoint = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")
    parsed = urllib.parse.urlparse(endpoint)
    try:
        with socket.create_connection((parsed.hostname, parsed.port or 80), timeout=0.75):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _emulator_reachable(), reason="local AWS emulator not reachable"
)


@pytest.fixture(scope="module")
def sqs_client():
    return boto3.client("sqs")


@pytest.fixture(scope="module")
def queue_url(sqs_client):
    try:
        return sqs_client.create_queue(QueueName=QUEUE_NAME)["QueueUrl"]
    except sqs_client.exceptions.QueueNameExists:
        return sqs_client.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"]


def _api_gateway_event(body: dict) -> dict:
    return {
        "version": "2.0",
        "routeKey": "POST /diagnoses",
        "rawPath": "/diagnoses",
        "requestContext": {"http": {"method": "POST", "path": "/diagnoses"}},
        "body": json.dumps(body),
        "isBase64Encoded": False,
    }


def test_posted_diagnosis_lands_on_the_intake_queue(queue_url, sqs_client):
    os.environ["GUARD_INTAKE_QUEUE_URL"] = queue_url
    from functions.diagnosis_relay.handler import handler as relay_handler

    diagnosis = {
        "type": "vibe_fault",
        "asset_id": "asset-relay-it-01",
        "metric": "vibe-axial",
        "fault_bands": [{"band": "mid", "energy": 9.4, "anomaly_score": 3.2}],
        "timestamp": "2026-07-03T09:00:00.000Z",
    }

    response = relay_handler(_api_gateway_event(diagnosis), None)
    assert response["statusCode"] == 202

    received = sqs_client.receive_message(
        QueueUrl=queue_url, MaxNumberOfMessages=1, WaitTimeSeconds=5
    )
    messages = received.get("Messages", [])
    assert len(messages) == 1

    landed_body = json.loads(messages[0]["Body"])
    assert landed_body == diagnosis

    sqs_client.delete_message(QueueUrl=queue_url, ReceiptHandle=messages[0]["ReceiptHandle"])
