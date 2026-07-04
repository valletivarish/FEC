"""publish_reading must target the exact contract topic pattern with a JSON body."""

import json

from sensors.mqtt_publisher import publish_reading


class FakeMqttClient:
    def __init__(self):
        self.calls = []

    def publish(self, topic, payload):
        self.calls.append((topic, payload))


def test_publish_reading_uses_contract_topic_pattern():
    client = FakeMqttClient()
    reading = {
        "pondId": "pond-01",
        "metric": "dissolved-oxygen",
        "value": 7.2,
        "unit": "mg/L",
        "timestamp": "2026-07-03T12:00:00+00:00",
    }
    publish_reading(client, reading)

    assert len(client.calls) == 1
    topic, payload = client.calls[0]
    assert topic == "aquasentinel/pond-01/dissolved-oxygen"
    assert json.loads(payload) == reading
