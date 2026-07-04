"""Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node
logic runs in-process against a scripted fixture, and events land in the local AWS emulator.
"""
import json
import os
import socket
import urllib.parse

import boto3
import pytest

from dispatcher import AlertDispatcher
from fog_life_support import LifeSupportFog
from fog_toxicity import ToxicityFog

READINGS_TABLE = os.environ.get("AQUASENTINEL_READINGS_TABLE", "AquaSentinelPondReadings")
ALERTS_TABLE = os.environ.get("AQUASENTINEL_ALERTS_TABLE", "AquaSentinelPondAlerts")
POND_ID = "pond-it-01"


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


class RecordingDispatcher(AlertDispatcher):
    """Records events instead of POSTing, so fog-node output can be replayed
    straight into the real Lambda handlers without a live HTTP hop."""

    def __init__(self) -> None:
        super().__init__(api_base_url="http://unused.invalid")
        self.dispatched: list[dict] = []

    def dispatch(self, event) -> bool:
        self.dispatched.append(event)
        return True


@pytest.fixture(scope="module")
def dynamodb_client():
    client = boto3.client("dynamodb")
    for table, sort_key in ((READINGS_TABLE, "metric_type_timestamp"), (ALERTS_TABLE, "timestamp")):
        try:
            client.create_table(
                TableName=table,
                BillingMode="PAY_PER_REQUEST",
                AttributeDefinitions=[
                    {"AttributeName": "pond_id", "AttributeType": "S"},
                    {"AttributeName": sort_key, "AttributeType": "S"},
                ],
                KeySchema=[
                    {"AttributeName": "pond_id", "KeyType": "HASH"},
                    {"AttributeName": sort_key, "KeyType": "RANGE"},
                ],
            )
        except client.exceptions.ResourceInUseException:
            pass
    return client


def _sqs_event(bodies: list[dict]) -> dict:
    return {"Records": [{"body": json.dumps(body)} for body in bodies]}


def test_dissolved_oxygen_crash_produces_a_hypoxia_critical_reading(dynamodb_client):
    from functions.ingest_readings.handler import handler as ingest_readings_handler

    dispatcher = RecordingDispatcher()
    node = LifeSupportFog()

    node.on_reading(
        {"pondId": POND_ID, "metric": "water-level", "value": 150.0, "timestamp": "2026-07-03T09:00:00.000Z"}
    )
    node.on_reading(
        {"pondId": POND_ID, "metric": "water-temperature", "value": 24.0, "timestamp": "2026-07-03T09:00:00.000Z"}
    )

    events = node.on_reading(
        {"pondId": POND_ID, "metric": "dissolved-oxygen", "value": 2.5, "timestamp": "2026-07-03T09:00:01.000Z"}
    )
    assert any(e["stage"] == "hypoxia_critical" for e in events)
    for event in events:
        dispatcher.dispatch(event)

    ingest_readings_handler(_sqs_event(dispatcher.dispatched), None)

    result = dynamodb_client.query(
        TableName=READINGS_TABLE,
        KeyConditionExpression="pond_id = :p",
        ExpressionAttributeValues={":p": {"S": POND_ID}},
    )
    items = result["Items"]
    assert any(
        item["type"]["S"] == "life_support" and item["payload"]["M"]["stage"]["S"] == "hypoxia_critical"
        for item in items
    )


def test_an_exposed_probe_suppresses_the_hypoxia_alarm():
    node = LifeSupportFog()
    node.on_reading(
        {"pondId": "pond-it-exposed", "metric": "water-level", "value": 10.0, "timestamp": "2026-07-03T09:05:00.000Z"}
    )

    events = node.on_reading(
        {
            "pondId": "pond-it-exposed",
            "metric": "dissolved-oxygen",
            "value": 1.0,
            "timestamp": "2026-07-03T09:05:01.000Z",
        }
    )
    assert events == []


def test_toxic_ammonia_reading_dispatches_immediately_with_provenance_and_persists(dynamodb_client):
    from functions.ingest_alerts.handler import handler as ingest_alerts_handler

    dispatcher = RecordingDispatcher()
    node = ToxicityFog()

    node.on_reading({"pondId": POND_ID, "metric": "ph", "value": 8.4, "timestamp": "2026-07-03T10:00:00.000Z"})
    node.on_reading(
        {"pondId": POND_ID, "metric": "water-temperature", "value": 29.0, "timestamp": "2026-07-03T10:00:00.000Z"}
    )
    node.on_reading(
        {"pondId": POND_ID, "metric": "salinity", "value": 18.0, "timestamp": "2026-07-03T10:00:00.000Z"}
    )

    events = node.on_reading(
        {"pondId": POND_ID, "metric": "ammonia-nh3-total", "value": 3.5, "timestamp": "2026-07-03T10:00:01.000Z"}
    )
    assert len(events) == 1
    assert events[0]["severity"] == "toxic"
    assert events[0]["provenance"]["ph"] == 8.4
    for event in events:
        dispatcher.dispatch(event)

    ingest_alerts_handler(_sqs_event(dispatcher.dispatched), None)

    result = dynamodb_client.query(
        TableName=ALERTS_TABLE,
        KeyConditionExpression="pond_id = :p",
        ExpressionAttributeValues={":p": {"S": POND_ID}},
    )
    items = result["Items"]
    assert any(item["severity"]["S"] == "toxic" and "provenance" in item for item in items)


def test_malformed_records_do_not_sink_either_batch():
    from functions.ingest_readings.handler import handler as ingest_readings_handler
    from functions.ingest_alerts.handler import handler as ingest_alerts_handler

    bad_event = {"Records": [{"body": "not valid json"}]}
    ingest_readings_handler(bad_event, None)
    ingest_alerts_handler(bad_event, None)
