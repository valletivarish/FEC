"""Wires the MQTT client's wildcard topic to a single reading callback shared by all fog nodes."""
import json
import logging

logger = logging.getLogger(__name__)

TOPIC_WILDCARD = "aquasentinel/+/+"


def subscribe_all(mqtt_client, on_reading):
    """Subscribes to every pond/metric combination and forwards parsed JSON bodies to on_reading."""

    def _on_message(client, userdata, message):
        try:
            reading = json.loads(message.payload)
        except (json.JSONDecodeError, UnicodeDecodeError):
            logger.exception("failed to parse MQTT payload on topic %s", message.topic)
            return
        on_reading(reading)

    def _on_connect(client, userdata, flags, rc, properties=None):
        # the broker only accepts SUBSCRIBE once CONNACK is back, so this can't happen pre-connect
        client.subscribe(TOPIC_WILDCARD)

    mqtt_client.on_message = _on_message
    mqtt_client.on_connect = _on_connect
