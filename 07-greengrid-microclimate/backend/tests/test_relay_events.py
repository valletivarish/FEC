import json

import boto3
import pytest
from moto import mock_aws

from conftest import import_handler

QUEUE_NAME = "greengrid-ingest-queue"


@pytest.fixture
def queue(monkeypatch):
    with mock_aws():
        client = boto3.client("sqs", region_name="eu-west-1")
        queue_url = client.create_queue(QueueName=QUEUE_NAME)["QueueUrl"]
        monkeypatch.setenv("GREENGRID_TARGET_QUEUE_URL", queue_url)
        yield client, queue_url


def test_relays_body_verbatim_to_configured_queue(queue):
    handler_module = import_handler("relay_events")

    sqs_client, queue_url = queue
    raw_body = json.dumps(
        {
            "type": "weather_event",
            "station_id": "station-quad",
            "storm_risk_score": 82.5,
            "timestamp": "2026-07-03T09:00:00Z",
        }
    )
    event = {"body": raw_body}

    result = handler_module.handler(event, None)

    assert result["statusCode"] == 202
    assert json.loads(result["body"]) == {"relayed": True}

    messages = sqs_client.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)
    assert messages["Messages"][0]["Body"] == raw_body
