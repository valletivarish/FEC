"""Entrypoint: connects to the MQTT broker and starts a sensor rig for each of the 3 vessels."""
import os
import signal
import time

import paho.mqtt.client as mqtt

from sensors.vessel_sensor_rig import VesselSensorRig

VESSEL_IDS = ("vessel-01", "vessel-02", "vessel-03")


def build_mqtt_client(host: str, port: int) -> mqtt.Client:
    client = mqtt.Client()
    client.connect(host, port)
    client.loop_start()
    return client


def main() -> None:
    host = os.environ.get("HARBORPULSE_MQTT_HOST", "localhost")
    port = int(os.environ.get("HARBORPULSE_MQTT_PORT", "1883"))

    mqtt_client = build_mqtt_client(host, port)
    rigs = [VesselSensorRig(vessel_id, mqtt_client) for vessel_id in VESSEL_IDS]

    stop_requested = {"stop": False}

    def handle_shutdown(signum, frame):
        stop_requested["stop"] = True

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    for rig in rigs:
        rig.start()

    try:
        while not stop_requested["stop"]:
            time.sleep(0.5)
    finally:
        for rig in rigs:
            rig.stop()
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


if __name__ == "__main__":
    main()
