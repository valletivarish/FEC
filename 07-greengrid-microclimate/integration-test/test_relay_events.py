"""Proves the relay Lambda -- not just the ingest Lambda -- actually moves a
POST-shaped body onto a real SQS queue via the local AWS emulator. This is the
piece the fog dispatcher's HTTP POST needs and the in-process tests never touched.
"""
import importlib.util
import json
import os
import socket
import urllib.parse
from pathlib import Path

import boto3
import pytest

ROOT = Path(__file__).resolve().parents[1]
QUEUE_NAME = "greengrid-ingest-queue-relay-it"


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


def _load_relay_handler():
    handler_path = ROOT / "backend" / "functions" / "relay_events" / "handler.py"
    spec = importlib.util.spec_from_file_location("relay_events_handler", handler_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def target_queue():
    sqs = boto3.client("sqs")
    queue_url = sqs.create_queue(QueueName=QUEUE_NAME)["QueueUrl"]
    yield sqs, queue_url
    sqs.delete_queue(QueueUrl=queue_url)


def test_relay_handler_delivers_the_raw_post_body_onto_the_real_sqs_queue(target_queue, monkeypatch):
    sqs, queue_url = target_queue
    monkeypatch.setenv("GREENGRID_TARGET_QUEUE_URL", queue_url)

    relay = _load_relay_handler()
    # relay's boto3 client is created at import time, so it must also see the env override
    relay.sqs = boto3.client("sqs")

    posted_body = json.dumps(
        {
            "type": "weather_event",
            "station_id": "station-relay-it",
            "storm_risk_score": 91.0,
            "timestamp": "2026-07-03T12:00:00Z",
        }
    )
    api_gateway_event = {
        "routeKey": "POST /events",
        "rawPath": "/events",
        "requestContext": {"http": {"method": "POST", "path": "/events"}},
        "body": posted_body,
        "isBase64Encoded": False,
    }

    response = relay.handler(api_gateway_event, None)
    assert response["statusCode"] == 202

    received = sqs.receive_message(QueueUrl=queue_url, WaitTimeSeconds=2, MaxNumberOfMessages=5)
    messages = received.get("Messages", [])
    assert len(messages) == 1
    assert messages[0]["Body"] == posted_body
    assert json.loads(messages[0]["Body"])["station_id"] == "station-relay-it"
