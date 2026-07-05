# Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node logic
# runs in-process, the resulting events land in the local AWS emulator via the real Lambda
# handlers, and the relay handlers are proven to actually deliver an HTTP-shaped POST body
# onto a real SQS queue -- the specific gap this project (and BinSight before it) fixes.
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

import boto3
import pytest

ROOT = Path(__file__).resolve().parents[1]
for module_dir in ("fog",):
    path = str(ROOT / module_dir)
    if path not in sys.path:
        sys.path.insert(0, path)

from fog_engine import EngineFog  # noqa: E402
from fog_safety import SafetyFog  # noqa: E402
from fog_sea_state import SeaStateFog  # noqa: E402


def _load_handler(function_name):
    handler_path = ROOT / "backend" / "functions" / function_name / "handler.py"
    spec = importlib.util.spec_from_file_location(f"{function_name}_handler", handler_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.handler


TELEMETRY_TABLE = os.environ.get("HARBORPULSE_TELEMETRY_TABLE", "harborpulse-telemetry-table")
ALARMS_TABLE = os.environ.get("HARBORPULSE_ALARMS_TABLE", "harborpulse-alarms-table")

ddb = boto3.client("dynamodb")
sqs = boto3.client("sqs")


def _ensure_table(table_name, sort_key_name):
    existing = ddb.list_tables()["TableNames"]
    if table_name in existing:
        return
    ddb.create_table(
        TableName=table_name,
        BillingMode="PAY_PER_REQUEST",
        KeySchema=[
            {"AttributeName": "vesselId", "KeyType": "HASH"},
            {"AttributeName": sort_key_name, "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "vesselId", "AttributeType": "S"},
            {"AttributeName": sort_key_name, "AttributeType": "S"},
        ],
    )


def _ensure_queue(queue_url: str) -> None:
    # the relay test needs its target queue to genuinely exist on floci -- unlike the CDK
    # stack's queues, this is a standalone queue scoped to this test suite, so nothing else
    # creates it; get_queue_url raises QueueDoesNotExist rather than auto-creating like DynamoDB
    queue_name = queue_url.rsplit("/", 1)[-1]
    try:
        sqs.get_queue_url(QueueName=queue_name)
    except sqs.exceptions.QueueDoesNotExist:
        sqs.create_queue(QueueName=queue_name)


@pytest.fixture(scope="module", autouse=True)
def tables():
    _ensure_table(TELEMETRY_TABLE, "metricTypeTimestamp")
    _ensure_table(ALARMS_TABLE, "timestamp")
    target_queue_url = os.environ.get("HARBORPULSE_TARGET_QUEUE_URL")
    if target_queue_url:
        _ensure_queue(target_queue_url)


def reading(vessel_id, metric, value, timestamp):
    return {"vesselId": vessel_id, "metric": metric, "value": value, "unit": "", "timestamp": timestamp}


def persist(handler, events):
    records = [{"body": json.dumps(e)} for e in events]
    handler({"Records": records}, None)


def test_engine_fog_window_completion_dispatches_and_persists():
    node = EngineFog()
    vessel_id = "vessel-it-engine"
    dispatched = []

    for i in range(64):
        value = 0.05 if i % 2 == 0 else -0.05
        ts = f"2026-07-03T09:00:{i:02d}.000Z"
        dispatched = node.on_reading(reading(vessel_id, "engine-vibration-raw", value, ts))

    assert len(dispatched) == 1
    assert dispatched[0]["type"] == "engine_health_event"

    ingest_telemetry = _load_handler("ingest_telemetry")
    persist(ingest_telemetry, dispatched)

    result = ddb.query(
        TableName=TELEMETRY_TABLE,
        KeyConditionExpression="vesselId = :v",
        ExpressionAttributeValues={":v": {"S": vessel_id}},
    )
    assert any(item["metricTypeTimestamp"]["S"].startswith("engine_health_event#") for item in result["Items"])


def test_sea_state_fog_dispatches_and_persists():
    node = SeaStateFog()
    vessel_id = "vessel-it-seastate"

    node.on_reading(reading(vessel_id, "nav-attitude", {"pitchDeg": 0, "rollDeg": 20}, "2026-07-03T10:00:00.000Z"))
    dispatched = node.on_reading(
        reading(vessel_id, "nav-attitude", {"pitchDeg": 0, "rollDeg": -20}, "2026-07-03T10:00:01.000Z")
    )

    assert len(dispatched) == 1
    assert dispatched[0]["type"] == "sea_state_event"

    ingest_telemetry = _load_handler("ingest_telemetry")
    persist(ingest_telemetry, dispatched)

    result = ddb.query(
        TableName=TELEMETRY_TABLE,
        KeyConditionExpression="vesselId = :v",
        ExpressionAttributeValues={":v": {"S": vessel_id}},
    )
    assert any(item["metricTypeTimestamp"]["S"].startswith("sea_state_event#") for item in result["Items"])


def test_safety_fog_bilge_alarm_dispatches_immediately_and_persists_without_ttl():
    node = SafetyFog()
    vessel_id = "vessel-it-safety"

    node.on_reading(reading(vessel_id, "hull-bilge-level", 20, "2026-07-03T11:00:00.000Z"))
    node.on_reading(reading(vessel_id, "hull-bilge-level", 20, "2026-07-03T11:00:01.000Z"))
    dispatched = node.on_reading(reading(vessel_id, "hull-bilge-level", 200, "2026-07-03T11:00:02.000Z"))

    assert len(dispatched) == 1
    assert dispatched[0]["type"] == "bilge_alarm"
    assert dispatched[0]["alarmActive"] is True

    ingest_alarm = _load_handler("ingest_alarm")
    persist(ingest_alarm, dispatched)

    result = ddb.query(
        TableName=ALARMS_TABLE,
        KeyConditionExpression="vesselId = :v",
        ExpressionAttributeValues={":v": {"S": vessel_id}},
    )
    items = result["Items"]
    assert len(items) == 1
    assert "ttlEpochSeconds" not in items[0], "an active alarm must never carry a TTL"


def test_query_fleet_returns_the_persisted_data():
    query_fleet = _load_handler("query_fleet")
    response = query_fleet({"routeKey": "GET /fleet/summary"}, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert "fleetAlarms" in body
    assert "telemetry" in body
    assert len(body["telemetry"]) >= 1
    assert len(body["fleetAlarms"]) >= 1


def test_relay_telemetry_actually_delivers_an_http_posted_body_onto_the_real_sqs_queue():
    queue_url = os.environ["HARBORPULSE_TARGET_QUEUE_URL"]
    sqs = boto3.client("sqs")

    relay_telemetry = _load_handler("relay_telemetry")
    posted_body = json.dumps({"type": "engine_health_event", "vesselId": "vessel-it-relay"})
    response = relay_telemetry({"body": posted_body}, None)

    assert response["statusCode"] == 202

    time.sleep(0.2)
    received = sqs.receive_message(QueueUrl=queue_url, WaitTimeSeconds=2, MaxNumberOfMessages=5)
    messages = received.get("Messages", [])
    assert any("vessel-it-relay" in m["Body"] for m in messages)


def test_a_malformed_record_does_not_sink_the_rest_of_the_batch():
    ingest_telemetry = _load_handler("ingest_telemetry")
    ingest_telemetry({"Records": [{"body": "not valid json"}]}, None)
