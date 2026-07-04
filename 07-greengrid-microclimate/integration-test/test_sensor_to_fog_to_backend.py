"""Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node
logic runs in-process against a scripted fixture, and events land in the local AWS emulator.
"""
import json
import os
import socket
import urllib.parse

import boto3
import pytest

from fog_weather import WeatherFog
from fog_soil import SoilFog
from fog_pollution import PollutionFog

READINGS_TABLE = os.environ.get("GREENGRID_READINGS_TABLE", "GreenGridReadings")
STATION_ID = "station-it-01"


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
def dynamodb_client():
    client = boto3.client("dynamodb")
    try:
        client.create_table(
            TableName=READINGS_TABLE,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": "station_id", "AttributeType": "S"},
                {"AttributeName": "event_type_timestamp", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "station_id", "KeyType": "HASH"},
                {"AttributeName": "event_type_timestamp", "KeyType": "RANGE"},
            ],
        )
    except client.exceptions.ResourceInUseException:
        pass
    return client


def _sqs_event(bodies: list[dict]) -> dict:
    return {"Records": [{"body": json.dumps(body)} for body in bodies]}


def _reading(metric, value, timestamp):
    return {"stationId": STATION_ID, "metric": metric, "value": value, "unit": "", "timestamp": timestamp}


def test_a_steep_pressure_drop_with_high_wind_and_rain_triggers_storm_watch_and_persists(dynamodb_client):
    from functions.ingest_handler.handler import handler as ingest_handler

    node = WeatherFog()
    dispatched = []

    dispatched += node.on_reading(_reading("barometric-pressure", 1020.0, "2026-07-03T09:00:00.000Z"))
    dispatched += node.on_reading(_reading("barometric-pressure", 990.0, "2026-07-03T09:00:01.000Z"))
    dispatched += node.on_reading(_reading("rainfall", 50.0, "2026-07-03T09:00:02.000Z"))
    dispatched += node.on_reading(_reading("wind-speed", 30.0, "2026-07-03T09:00:03.000Z"))
    dispatched += node.on_reading(_reading("wind-direction", 180.0, "2026-07-03T09:00:04.000Z"))

    assert any(e["type"] == "weather_event" and e["storm_risk_score"] >= 70 for e in dispatched)

    ingest_handler(_sqs_event(dispatched), None)

    result = dynamodb_client.query(
        TableName=READINGS_TABLE,
        KeyConditionExpression="station_id = :s",
        ExpressionAttributeValues={":s": {"S": STATION_ID}},
    )
    items = result["Items"]
    assert any(item["type"]["S"] == "weather_event" for item in items)


def test_sustained_high_leaf_wetness_in_the_fungal_band_triggers_disease_risk_and_persists(dynamodb_client):
    from functions.ingest_handler.handler import handler as ingest_handler

    node = SoilFog()
    dispatched = []

    dispatched += node.on_reading(_reading("air-temperature", 20.0, "2026-07-03T10:00:00.000Z"))
    for i in range(3):
        dispatched += node.on_reading(_reading("leaf-wetness", 9.0, f"2026-07-03T10:00:0{i + 1}.000Z"))

    assert any(e["type"] == "soil_event" and e["risk"] == "disease_risk" for e in dispatched)

    ingest_handler(_sqs_event(dispatched), None)

    result = dynamodb_client.query(
        TableName=READINGS_TABLE,
        KeyConditionExpression="station_id = :s",
        ExpressionAttributeValues={":s": {"S": STATION_ID}},
    )
    items = result["Items"]
    assert any(item["type"]["S"] == "soil_event" and item["risk"]["S"] == "disease_risk" for item in items)


def test_a_baseline_to_spike_pm25_shift_triggers_exceedance_watch_and_persists(dynamodb_client):
    from functions.ingest_handler.handler import handler as ingest_handler

    node = PollutionFog()
    dispatched = []

    for i, value in enumerate([10.0] * 10 + [500.0] * 10):
        dispatched += node.on_reading(_reading("pm2-5", value, f"2026-07-03T11:{i:02d}:00.000Z"))

    assert any(e["type"] == "pollution_event" and e["metric"] == "pm2-5" for e in dispatched)

    ingest_handler(_sqs_event(dispatched), None)

    result = dynamodb_client.query(
        TableName=READINGS_TABLE,
        KeyConditionExpression="station_id = :s",
        ExpressionAttributeValues={":s": {"S": STATION_ID}},
    )
    items = result["Items"]
    assert any(item["type"]["S"] == "pollution_event" for item in items)


def test_malformed_record_does_not_sink_the_batch():
    from functions.ingest_handler.handler import handler as ingest_handler

    event = {"Records": [{"body": "not valid json"}]}
    ingest_handler(event, None)
