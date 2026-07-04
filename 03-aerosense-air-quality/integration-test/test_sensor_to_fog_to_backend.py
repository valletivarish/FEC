"""Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node
logic runs in-process against a scripted fixture, and events land in the local AWS emulator.
"""
import json
import os
import socket
import urllib.parse

import boto3
import pytest

from dispatcher import AdvisoryDispatcher
from fog_particulate import FogParticulate
from fog_gases import FogGases

ADVISORY_TABLE = os.environ.get("AEROSENSE_ADVISORY_TABLE", "AeroSenseAdvisoryEvents")
ZONE_ID = "zone-it-01"


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


class RecordingDispatcher(AdvisoryDispatcher):
    """Records advisories instead of POSTing, so fog-node output can be replayed
    straight into the real Lambda handler without a live HTTP hop."""

    def __init__(self) -> None:
        super().__init__(api_base_url="http://unused.invalid")
        self.dispatched: list[dict] = []

    def dispatch(self, advisory) -> bool:
        self.dispatched.append(advisory.to_dict())
        return True


@pytest.fixture(scope="module")
def dynamodb_client():
    client = boto3.client("dynamodb")
    try:
        client.create_table(
            TableName=ADVISORY_TABLE,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": "zone_id", "AttributeType": "S"},
                {"AttributeName": "event_timestamp_sensor", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "zone_id", "KeyType": "HASH"},
                {"AttributeName": "event_timestamp_sensor", "KeyType": "RANGE"},
            ],
        )
    except client.exceptions.ResourceInUseException:
        pass
    return client


def _sqs_event(bodies: list[dict]) -> dict:
    return {"Records": [{"body": json.dumps(body)} for body in bodies]}


def test_pm25_sustained_rise_crosses_a_band_and_persists(dynamodb_client):
    from functions.advisory_ingest.handler import handler as advisory_ingest_handler

    dispatcher = RecordingDispatcher()
    node = FogParticulate(dispatcher)

    # Fills the 5-sample rolling window at a steady "good" band first.
    good_readings = [
        {"zone_id": ZONE_ID, "topic": "pm25", "value": 8.0, "timestamp": f"2026-07-02T10:00:0{i}.000Z"}
        for i in range(5)
    ]
    for reading in good_readings:
        node.handle_reading(reading)
    assert dispatcher.dispatched, "the first reading always emits an initial band advisory"
    dispatcher.dispatched.clear()

    # 5 consecutive elevated readings shift the rolling median itself into "moderate",
    # a genuine band_change rather than a single-reading spike.
    for i in range(5):
        node.handle_reading(
            {"zone_id": ZONE_ID, "topic": "pm25", "value": 20.0, "timestamp": f"2026-07-02T10:01:0{i}.000Z"}
        )
    assert any(a["advisory_type"] == "band_change" and a["band"] == "moderate" for a in dispatcher.dispatched)

    advisory_ingest_handler(_sqs_event(dispatcher.dispatched), None)

    result = dynamodb_client.query(
        TableName=ADVISORY_TABLE,
        KeyConditionExpression="zone_id = :z",
        ExpressionAttributeValues={":z": {"S": ZONE_ID}},
    )
    items = result["Items"]
    assert any(item["advisory_type"]["S"] == "band_change" for item in items)


def test_pm25_single_sharp_jump_dispatches_a_spike(dynamodb_client):
    dispatcher = RecordingDispatcher()
    node = FogParticulate(dispatcher)

    for i in range(5):
        node.handle_reading(
            {"zone_id": ZONE_ID, "topic": "pm25", "value": 8.0, "timestamp": f"2026-07-02T10:02:0{i}.000Z"}
        )
    dispatcher.dispatched.clear()

    # One extreme reading inside an otherwise steady window: the median barely moves,
    # but the raw value alone crosses the spike threshold (1.4x the band's upper edge).
    node.handle_reading(
        {"zone_id": ZONE_ID, "topic": "pm25", "value": 60.0, "timestamp": "2026-07-02T10:02:10.000Z"}
    )
    assert any(a["advisory_type"] == "spike" for a in dispatcher.dispatched)


def test_co2_rate_of_rise_produces_a_persisted_advisory(dynamodb_client):
    from functions.advisory_ingest.handler import handler as advisory_ingest_handler

    dispatcher = RecordingDispatcher()
    node = FogGases(dispatcher)

    # The first reading only seeds the EWMA (no rate available yet); reading 2 breaches
    # the 50 ppm/min threshold once, and 2 consecutive breaches are required to dispatch,
    # so a 3rd and 4th sharply-rising reading are both needed here.
    readings = [
        {"zone_id": ZONE_ID, "topic": "co2", "value": 500.0, "timestamp": "2026-07-02T11:00:00.000Z"},
        {"zone_id": ZONE_ID, "topic": "co2", "value": 650.0, "timestamp": "2026-07-02T11:01:00.000Z"},
        {"zone_id": ZONE_ID, "topic": "co2", "value": 820.0, "timestamp": "2026-07-02T11:02:00.000Z"},
        {"zone_id": ZONE_ID, "topic": "co2", "value": 1050.0, "timestamp": "2026-07-02T11:03:00.000Z"},
    ]
    for reading in readings:
        node.handle_reading(reading)

    assert any(a["advisory_type"] == "rate_of_rise" for a in dispatcher.dispatched)

    advisory_ingest_handler(_sqs_event(dispatcher.dispatched), None)

    result = dynamodb_client.query(
        TableName=ADVISORY_TABLE,
        KeyConditionExpression="zone_id = :z",
        ExpressionAttributeValues={":z": {"S": ZONE_ID}},
    )
    items = result["Items"]
    assert any(item["advisory_type"]["S"] == "rate_of_rise" for item in items)


def test_malformed_record_does_not_raise():
    from functions.advisory_ingest.handler import handler as advisory_ingest_handler

    event = {"Records": [{"body": "not valid json"}]}
    # Should not raise; a single bad record must not sink the whole SQS batch.
    advisory_ingest_handler(event, None)
