"""Proves the HTTP relay path is real: an API-Gateway-shaped POST reaches advisory_intake,
which must land the raw body on the actual SQS queue in the local AWS emulator.
"""
import json
import os
import socket
import sys
import urllib.parse
from pathlib import Path

import boto3
import pytest

ROOT = Path(__file__).resolve().parents[1]
FUNCTIONS_ROOT = str(ROOT / "backend" / "functions" / "advisory_intake")
SHARED_ROOT = str(ROOT / "backend")

QUEUE_NAME = "aerosense-relay-it-advisory-queue"


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


def test_post_advisories_body_lands_on_the_real_queue():
    sqs = boto3.client("sqs")
    queue_url = sqs.create_queue(QueueName=QUEUE_NAME)["QueueUrl"]

    # handler.py reads its queue URL as a module-level constant, so the env
    # var must exist before the module is imported, not just before the call.
    os.environ["AEROSENSE_ADVISORY_QUEUE_URL"] = queue_url
    if SHARED_ROOT not in sys.path:
        sys.path.insert(0, SHARED_ROOT)
    sys.path = [p for p in sys.path if not p.startswith(FUNCTIONS_ROOT)]
    sys.path.insert(0, FUNCTIONS_ROOT)
    sys.modules.pop("handler", None)
    import handler as advisory_intake_handler

    try:
        advisory = {
            "zone_id": "zone-relay-it",
            "sensor": "pm25",
            "advisory_type": "band_change",
            "band": "moderate",
            "value": 42.5,
            "details": {"previous_band": "good"},
            "timestamp": "2026-07-02T10:00:00Z",
        }
        api_gateway_event = {
            "version": "2.0",
            "routeKey": "POST /advisories",
            "rawPath": "/advisories",
            "requestContext": {"http": {"method": "POST", "path": "/advisories"}},
            "body": json.dumps(advisory),
            "isBase64Encoded": False,
        }

        response = advisory_intake_handler.handler(api_gateway_event, None)
        assert response["statusCode"] == 202

        received = sqs.receive_message(
            QueueUrl=queue_url, MaxNumberOfMessages=1, WaitTimeSeconds=5
        )
        messages = received.get("Messages", [])
        assert messages, "relay must actually enqueue the advisory on the real SQS queue"
        landed = json.loads(messages[0]["Body"])
        assert landed == advisory
    finally:
        sqs.delete_queue(QueueUrl=queue_url)
