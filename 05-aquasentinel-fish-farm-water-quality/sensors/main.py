"""Runnable entrypoint: starts sensor rigs for all 4 ponds and publishes to MQTT."""

import os
import signal
import sys
import time
from pathlib import Path

import paho.mqtt.client as mqtt

from sensors.mqtt_publisher import publish_reading
from sensors.pond_sensor_rig import PondSensorRig

CONFIG_DIR = Path(__file__).parent / "config"
POND_IDS = ["pond-01", "pond-02", "pond-03", "pond-04"]


def _parse_broker_url(broker_url):
    # accepts mqtt://host:port, strips the scheme paho doesn't understand
    stripped = broker_url.split("://", 1)[-1]
    host, _, port = stripped.partition(":")
    return host, int(port) if port else 1883


def main():
    broker_url = os.environ.get("MQTT_BROKER_URL", "mqtt://localhost:1883")
    host, port = _parse_broker_url(broker_url)

    client = mqtt.Client()
    client.connect(host, port)
    client.loop_start()

    rigs = []
    for pond_id in POND_IDS:
        config_path = CONFIG_DIR / f"{pond_id}.yaml"
        rig = PondSensorRig(config_path, lambda reading: publish_reading(client, reading))
        rig.start()
        rigs.append(rig)

    def shutdown(signum, frame):
        for rig in rigs:
            rig.stop()
        client.loop_stop()
        client.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while True:
        time.sleep(1)


if __name__ == "__main__":
    main()
