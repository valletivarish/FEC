"""Runnable entrypoint: connects to MQTT_BROKER_URL and starts a rig per asset."""
import os
import signal
import time
from urllib.parse import urlparse

import paho.mqtt.client as mqtt

from sensors.asset_sensor_rig import AssetSensorRig

ASSET_IDS = ("asset-01", "asset-02", "asset-03", "asset-04")
CONFIG_DIR = os.path.join(os.path.dirname(__file__), "config")


def build_mqtt_client(broker_url):
    parsed = urlparse(broker_url)
    client = mqtt.Client()
    client.connect(parsed.hostname, parsed.port or 1883)
    client.loop_start()
    return client


def main():
    broker_url = os.environ["MQTT_BROKER_URL"]
    mqtt_client = build_mqtt_client(broker_url)

    rigs = []
    for asset_id in ASSET_IDS:
        config_path = os.path.join(CONFIG_DIR, f"{asset_id}.yaml")
        rig = AssetSensorRig(config_path, mqtt_client).start()
        rigs.append(rig)

    stop = {"requested": False}

    def _handle_signal(signum, frame):
        stop["requested"] = True

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    while not stop["requested"]:
        time.sleep(0.5)

    for rig in rigs:
        rig.stop()
    mqtt_client.loop_stop()
    mqtt_client.disconnect()


if __name__ == "__main__":
    main()
