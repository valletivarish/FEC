"""Publishes a single sensor reading to its MQTT topic as JSON."""
import json

TOPIC_TEMPLATE = "greengrid/{station_id}/{metric}"


def publish_reading(mqtt_client, reading: dict) -> None:
    """reading must have stationId and metric keys; topic is derived from them."""
    topic = TOPIC_TEMPLATE.format(station_id=reading["stationId"], metric=reading["metric"])
    payload = json.dumps(reading)
    mqtt_client.publish(topic, payload)
