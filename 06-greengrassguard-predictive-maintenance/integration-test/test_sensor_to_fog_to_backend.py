"""Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node
logic runs in-process against a scripted fixture, and events land in the local AWS emulator.
"""
import json
import math
import os
import socket
import urllib.parse

import boto3
import pytest

from fog_vibe_core import VibeCore
from fog_thermal_guard import ThermalGuard
from fog_hydraulic import HydraulicFog

DIAGNOSIS_TABLE = os.environ.get("GUARD_DIAGNOSIS_TABLE", "GuardDiagnosisEvents")
ASSET_ID = "asset-it-01"


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


def _sine_window(amplitude, n=32):
    return [amplitude * math.sin(2 * math.pi * 0.3 * i) for i in range(n)]


@pytest.fixture(scope="module")
def dynamodb_client():
    client = boto3.client("dynamodb")
    try:
        client.create_table(
            TableName=DIAGNOSIS_TABLE,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": "asset_id", "AttributeType": "S"},
                {"AttributeName": "event_type_timestamp", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "asset_id", "KeyType": "HASH"},
                {"AttributeName": "event_type_timestamp", "KeyType": "RANGE"},
            ],
        )
    except client.exceptions.ResourceInUseException:
        pass
    return client


def _sqs_event(bodies: list[dict]) -> dict:
    return {"Records": [{"body": json.dumps(body)} for body in bodies]}


def test_a_vibration_spike_produces_a_vibe_fault_that_persists(dynamodb_client):
    from functions.intake_handler.handler import handler as intake_handler

    node = VibeCore()
    dispatched = []

    # a quiet reading seeds the EWMA baseline low.
    dispatched += node.on_reading({
        "assetId": ASSET_ID, "metric": "vibe-axial", "value": 1.0,
        "window": _sine_window(0.05), "timestamp": "2026-07-03T09:00:00.000Z",
    })
    # two consecutive high-amplitude readings are needed to clear the 2-breach gate.
    for i in range(2):
        dispatched += node.on_reading({
            "assetId": ASSET_ID, "metric": "vibe-axial", "value": 10.0,
            "window": _sine_window(5.0), "timestamp": f"2026-07-03T09:00:0{i + 1}.000Z",
        })

    assert any(e["type"] == "vibe_fault" for e in dispatched)
    fault = next(e for e in dispatched if e["type"] == "vibe_fault")
    assert len(fault["fault_bands"]) <= 3

    intake_handler(_sqs_event(dispatched), None)

    result = dynamodb_client.query(
        TableName=DIAGNOSIS_TABLE,
        KeyConditionExpression="asset_id = :a",
        ExpressionAttributeValues={":a": {"S": ASSET_ID}},
    )
    items = result["Items"]
    assert any(item["type"]["S"] == "vibe_fault" for item in items)


def test_a_sustained_winding_temp_climb_produces_a_runaway_thermal_event(dynamodb_client):
    from functions.intake_handler.handler import handler as intake_handler

    node = ThermalGuard()
    dispatched = []

    # 20 readings fill the window, 4 more sustain the >0.5 slope for 5 consecutive evaluations.
    for i in range(24):
        events = node.on_reading({
            "assetId": ASSET_ID, "metric": "thermal-winding", "value": 20.0 + i,
            "timestamp": f"2026-07-03T10:{i:02d}:00.000Z",
        })
        dispatched += events

    assert any("runaway" in e["verdict_tags"] for e in dispatched)

    intake_handler(_sqs_event(dispatched), None)

    result = dynamodb_client.query(
        TableName=DIAGNOSIS_TABLE,
        KeyConditionExpression="asset_id = :a",
        ExpressionAttributeValues={":a": {"S": ASSET_ID}},
    )
    items = result["Items"]
    assert any(item["type"]["S"] == "thermal_event" for item in items)


def test_erratic_flow_with_low_pressure_flags_cavitation_but_steady_flow_does_not():
    node = HydraulicFog()
    node.on_reading({
        "assetId": "asset-it-cavitation", "metric": "electrical-current-rms",
        "value": 20.0, "timestamp": "2026-07-03T11:00:00.000Z",
    })
    for i, flow in enumerate([50.0, 150.0, 40.0, 160.0, 45.0]):
        node.on_reading({
            "assetId": "asset-it-cavitation", "metric": "hydraulic-flow",
            "value": flow, "timestamp": f"2026-07-03T11:00:0{i}.000Z",
        })

    events = node.on_reading({
        "assetId": "asset-it-cavitation", "metric": "hydraulic-discharge-pressure",
        "value": 5.0, "timestamp": "2026-07-03T11:00:10.000Z",
    })
    assert any(e["cavitation_suspected"] for e in events)

    steady_node = HydraulicFog()
    steady_node.on_reading({
        "assetId": "asset-it-steady", "metric": "electrical-current-rms",
        "value": 20.0, "timestamp": "2026-07-03T11:05:00.000Z",
    })
    for i in range(5):
        steady_node.on_reading({
            "assetId": "asset-it-steady", "metric": "hydraulic-flow",
            "value": 100.0, "timestamp": f"2026-07-03T11:05:0{i}.000Z",
        })
    steady_events = steady_node.on_reading({
        "assetId": "asset-it-steady", "metric": "hydraulic-discharge-pressure",
        "value": 5.0, "timestamp": "2026-07-03T11:05:10.000Z",
    })
    assert not any(e["cavitation_suspected"] for e in steady_events)


def test_malformed_record_does_not_sink_the_batch():
    from functions.intake_handler.handler import handler as intake_handler

    event = {"Records": [{"body": "not valid json"}]}
    intake_handler(event, None)
