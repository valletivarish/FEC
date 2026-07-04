"""Publishes sensor readings to the exact MQTT topic pattern the fog layer subscribes to."""
import json

TOPIC_TEMPLATE = "greengrassguard/{assetId}/{metric}"


def publish_reading(mqtt_client, reading):
    """Publish a reading dict as JSON to greengrassguard/{assetId}/{metric}.

    reading must contain at least assetId and metric; the whole dict is the payload
    so vibration readings' extra `window` field passes through untouched.
    """
    topic = TOPIC_TEMPLATE.format(assetId=reading["assetId"], metric=reading["metric"])
    payload = json.dumps(reading)
    mqtt_client.publish(topic, payload)
    return topic
