"""Confirms publish_reading targets the exact harborpulse/{vesselId}/{metric} topic contract."""
import json

from sensors.mqtt_publisher import publish_reading


class FakeMqttClient:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload):
        self.published.append((topic, payload))


def test_publishes_to_exact_topic_pattern():
    client = FakeMqttClient()
    reading = {
        "vesselId": "vessel-01",
        "metric": "engine-rpm",
        "value": 1200,
        "unit": "rpm",
        "timestamp": "2026-07-03T12:00:00+00:00",
    }
    publish_reading(client, reading)

    assert len(client.published) == 1
    topic, payload = client.published[0]
    assert topic == "harborpulse/vessel-01/engine-rpm"
    assert json.loads(payload) == reading


def test_publishes_object_valued_metric_as_json_object():
    client = FakeMqttClient()
    reading = {
        "vesselId": "vessel-02",
        "metric": "nav-gps",
        "value": {"lat": 53.35, "lon": -6.26},
        "unit": "latlon",
        "timestamp": "2026-07-03T12:00:00+00:00",
    }
    publish_reading(client, reading)

    topic, payload = client.published[0]
    assert topic == "harborpulse/vessel-02/nav-gps"
    decoded = json.loads(payload)
    assert decoded["value"] == {"lat": 53.35, "lon": -6.26}
