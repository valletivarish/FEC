"""CLI entrypoint: loads a zone profile, runs its SensorRig, publishes to MQTT."""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
from types import FrameType
from typing import Optional
from urllib.parse import urlparse

import paho.mqtt.client as mqtt
import yaml

from sensors.sensor_rig import Reading, SensorRig
from sensors.units import build_topic

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("aerosense.run_rig")

DEFAULT_PROFILE_PATH = "sensors/profiles/zone_default.yaml"
DEFAULT_BROKER_URL = "tcp://localhost:1883"
MAX_BACKOFF_S = 30.0


def load_profile(path: str) -> tuple[str, dict]:
    """Read a zone YAML profile and return (zone_id, per-sensor config dict)."""
    with open(path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    return data["zone_id"], data["sensors"]


def _parse_broker_url(broker_url: str) -> tuple[str, int]:
    """paho wants host/port separately; the contract gives a tcp:// URL."""
    parsed = urlparse(broker_url)
    return parsed.hostname or "localhost", parsed.port or 1883


class MqttPublisher:
    """Wraps a paho-mqtt client with reconnect-with-backoff on connection loss."""

    def __init__(self, broker_url: str) -> None:
        self._host, self._port = _parse_broker_url(broker_url)
        self._client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        self._client.on_disconnect = self._on_disconnect
        self._connected = False

    def connect(self) -> None:
        backoff = 1.0
        while True:
            try:
                self._client.connect(self._host, self._port)
                self._client.loop_start()
                self._connected = True
                logger.info("connected to broker at %s:%s", self._host, self._port)
                return
            except OSError as exc:
                logger.warning("mqtt connect failed (%s), retrying in %.1fs", exc, backoff)
                time.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_S)

    def _on_disconnect(self, client: mqtt.Client, userdata: object, *args: object) -> None:
        # paho v2 passes (reason_code, properties) or a disconnect_flags packet
        # depending on transport; args is intentionally unpacked loosely here.
        self._connected = False
        logger.warning("disconnected from broker, will reconnect on next publish")

    def publish(self, topic: str, reading: Reading) -> None:
        if not self._connected:
            self.connect()
        payload = json.dumps(reading)
        result = self._client.publish(topic, payload, qos=1)
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            logger.warning("publish to %s failed with rc=%s", topic, result.rc)

    def close(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()


def main() -> None:
    profile_path = os.environ.get("AEROSENSE_ZONE_PROFILE", DEFAULT_PROFILE_PATH)
    broker_url = os.environ.get("MQTT_BROKER_URL", DEFAULT_BROKER_URL)

    zone_id, sensor_configs = load_profile(profile_path)
    publisher = MqttPublisher(broker_url)
    publisher.connect()

    def on_dispatch(reading: Reading) -> None:
        topic = build_topic(zone_id, str(reading["topic"]))
        publisher.publish(topic, reading)

    rig = SensorRig(zone_id=zone_id, profiles=sensor_configs, on_dispatch=on_dispatch)
    rig.start()
    logger.info("sensor rig running for zone '%s' with %d sensors", zone_id, len(sensor_configs))

    stop_requested = False

    def _handle_signal(signum: int, frame: Optional[FrameType]) -> None:
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        while not stop_requested:
            time.sleep(0.5)
    finally:
        logger.info("shutting down sensor rig for zone '%s'", zone_id)
        rig.stop()
        publisher.close()


if __name__ == "__main__":
    sys.exit(main())
