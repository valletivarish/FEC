import json

import boto3
import pytest
from moto import mock_aws

QUEUE_NAME = "harborpulse-telemetry-queue"


@pytest.fixture
def queue(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
    with mock_aws():
        client = boto3.client("sqs", region_name="eu-west-1")
        queue_url = client.create_queue(QueueName=QUEUE_NAME)["QueueUrl"]
        monkeypatch.setenv("HARBORPULSE_TARGET_QUEUE_URL", queue_url)
        yield client, queue_url


def test_relays_body_verbatim_to_configured_queue(queue):
    from backend.functions.relay_telemetry import handler as handler_module

    sqs_client, queue_url = queue
    raw_body = json.dumps(
        {
            "type": "engine_health_event",
            "vesselId": "vessel-01",
            "rms": 1.1,
            "bearingWearEnergy": 0.2,
            "degradedBearing": False,
            "engineRpm": 1500,
            "coolantTempC": 70.0,
            "oilPressureKpa": 350.0,
            "fuelFlowLph": 10.0,
            "timestamp": "2026-07-03T12:00:00Z",
        }
    )
    event = {"body": raw_body}

    result = handler_module.handler(event, None)

    assert result["statusCode"] == 202
    assert json.loads(result["body"]) == {"relayed": True}

    messages = sqs_client.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
    assert messages["Messages"][0]["Body"] == raw_body
