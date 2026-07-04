"""MQTT wiring: subscribes to every station/metric topic and hands parsed readings to a callback."""
import json

TOPIC_FILTER = 'greengrid/+/+'


def subscribe_all(mqtt_client, on_reading):
    def _on_message(client, userdata, message):
        reading = json.loads(message.payload.decode('utf-8'))
        on_reading(reading)

    mqtt_client.on_message = _on_message
    mqtt_client.subscribe(TOPIC_FILTER)
