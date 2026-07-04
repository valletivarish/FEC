"""Publishes sensor readings onto the harborpulse/{vesselId}/{metric} MQTT topic contract."""
import json

TOPIC_TEMPLATE = "harborpulse/{vesselId}/{metric}"


def publish_reading(mqtt_client, reading: dict) -> None:
    topic = TOPIC_TEMPLATE.format(vesselId=reading["vesselId"], metric=reading["metric"])
    payload = json.dumps(reading)
    mqtt_client.publish(topic, payload)
