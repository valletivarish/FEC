import json

from sensor_subscriber import subscribe_all


class FakeMqttClient:
    def __init__(self):
        self.on_message = None
        self.subscribed_topics = []

    def subscribe(self, topic):
        self.subscribed_topics.append(topic)


class FakeMessage:
    def __init__(self, payload_dict):
        self.payload = json.dumps(payload_dict).encode('utf-8')


def test_subscribes_to_wildcard_station_and_metric_topic():
    client = FakeMqttClient()
    subscribe_all(client, on_reading=lambda r: None)

    assert client.subscribed_topics == ['greengrid/+/+']


def test_parses_json_payload_and_invokes_callback():
    client = FakeMqttClient()
    received = []
    subscribe_all(client, on_reading=received.append)

    reading = {
        'stationId': 'station-quad',
        'metric': 'air-temperature',
        'value': 18.5,
        'unit': 'degC',
        'timestamp': '2026-01-01T00:00:00Z',
    }
    client.on_message(client, None, FakeMessage(reading))

    assert received == [reading]
