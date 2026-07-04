"""Subscribes to sensor readings on the shared MQTT broker and fans them out."""
from __future__ import annotations

import json
import logging
from typing import Callable
from urllib.parse import urlparse

import paho.mqtt.client as mqtt

logger = logging.getLogger(__name__)

# Matches aerosense/{zone_id}/{topic} for every zone and every sensor topic.
_TOPIC_FILTER = "aerosense/+/+"

ReadingHandler = Callable[[dict], None]


def subscribe_to_readings(broker_url: str, on_reading: ReadingHandler) -> mqtt.Client:
    """Connect to broker_url and invoke on_reading(reading_dict) for every message."""
    parsed = urlparse(broker_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 1883

    client = mqtt.Client()

    def _on_connect(client: mqtt.Client, userdata: object, flags: dict, rc: int) -> None:
        client.subscribe(_TOPIC_FILTER)

    def _on_message(client: mqtt.Client, userdata: object, msg: mqtt.MQTTMessage) -> None:
        try:
            reading = json.loads(msg.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            logger.warning("dropping malformed payload on %s: %s", msg.topic, exc)
            return
        on_reading(reading)

    client.on_connect = _on_connect
    client.on_message = _on_message
    client.connect(host, port)
    client.loop_start()
    return client
