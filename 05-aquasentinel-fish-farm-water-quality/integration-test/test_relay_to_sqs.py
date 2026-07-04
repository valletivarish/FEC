"""Proves the API-Gateway-facing relay Lambdas actually place the fog dispatcher's POST body
onto SQS, closing the gap between the dispatcher's HTTP POST and the queue-triggered ingest path.
"""
import json
import os
import socket
import urllib.parse

import boto3
import pytest

RELAY_READINGS_QUEUE_NAME = "aquasentinel-relay-it-readings-queue"


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
def relay_readings_queue_url(sqs_client):
    try:
        resp = sqs_client.create_queue(QueueName=RELAY_READINGS_QUEUE_NAME)
    except sqs_client.exceptions.QueueNameExists:
        resp = sqs_client.get_queue_url(QueueName=RELAY_READINGS_QUEUE_NAME)
    return resp["QueueUrl"]


def test_relay_readings_handler_places_raw_body_on_the_queue(sqs_client, relay_readings_queue_url):
    os.environ["AQUASENTINEL_READINGS_QUEUE_URL"] = relay_readings_queue_url

    from functions.relay_readings.handler import handler as relay_readings_handler

    reading = {
        "type": "life_support",
        "pond_id": "pond-relay-it-01",
        "stage": "hypoxia_warning",
        "dissolved_oxygen": 3.8,
        "timestamp": "2026-07-03T09:00:00.000Z",
    }
    api_gateway_event = {
        "version": "2.0",
        "routeKey": "POST /readings",
        "rawPath": "/readings",
        "body": json.dumps(reading),
        "isBase64Encoded": False,
    }

    result = relay_readings_handler(api_gateway_event, None)
    assert result["statusCode"] == 202

    received = sqs_client.receive_message(
        QueueUrl=relay_readings_queue_url,
        MaxNumberOfMessages=1,
        WaitTimeSeconds=5,
    )
    messages = received.get("Messages", [])
    assert len(messages) == 1
    landed_body = json.loads(messages[0]["Body"])
    assert landed_body == reading

    sqs_client.delete_message(
        QueueUrl=relay_readings_queue_url, ReceiptHandle=messages[0]["ReceiptHandle"]
    )
