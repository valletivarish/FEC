"""publish_reading must hit the exact topic pattern the fog layer subscribes to."""
import json

from sensors.mqtt_publisher import publish_reading


class _FakeMqttClient:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload):
        self.published.append((topic, payload))


def test_publish_reading_uses_contract_topic_pattern():
    client = _FakeMqttClient()
    reading = {
        "assetId": "asset-01",
        "metric": "thermal-winding",
        "value": 45.2,
        "unit": "degC",
        "timestamp": "2026-07-02T10:00:00+00:00",
    }
    topic = publish_reading(client, reading)
    assert topic == "greengrassguard/asset-01/thermal-winding"
    assert client.published[0][0] == "greengrassguard/asset-01/thermal-winding"


def test_publish_reading_payload_is_valid_json_of_full_reading():
    client = _FakeMqttClient()
    reading = {
        "assetId": "asset-02",
        "metric": "vibe-axial",
        "value": 3.1,
        "unit": "mm/s",
        "timestamp": "2026-07-02T10:00:00+00:00",
        "window": [0.1, 0.2, 0.3],
    }
    publish_reading(client, reading)
    _, payload = client.published[0]
    decoded = json.loads(payload)
    assert decoded == reading
