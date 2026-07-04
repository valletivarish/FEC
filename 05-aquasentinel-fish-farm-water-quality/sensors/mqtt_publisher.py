"""Publishes a single sensor reading to its MQTT topic as JSON."""

import json


def publish_reading(mqtt_client, reading):
    """Publish `reading` dict to aquasentinel/{pondId}/{metric}.

    reading must contain pondId and metric keys per the shared contract.
    """
    topic = f"aquasentinel/{reading['pondId']}/{reading['metric']}"
    payload = json.dumps(reading)
    mqtt_client.publish(topic, payload)
