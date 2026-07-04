"""Entrypoint: connects to the MQTT broker and starts the sensor rig for
all 3 campus stations."""
import os
import time
import urllib.parse

import paho.mqtt.client as mqtt

from station_sensor_rig import StationSensorRig, load_station_config

STATION_IDS = ["station-quad", "station-north-lawn", "station-arboretum"]


def build_mqtt_client(broker_url: str) -> mqtt.Client:
    parsed = urllib.parse.urlparse(broker_url)
    client = mqtt.Client()
    client.connect(parsed.hostname, parsed.port or 1883)
    client.loop_start()
    return client


def main():
    broker_url = os.environ["MQTT_BROKER_URL"]
    mqtt_client = build_mqtt_client(broker_url)

    rigs = []
    for station_id in STATION_IDS:
        config = load_station_config(station_id)
        rig = StationSensorRig(config, mqtt_client)
        rig.start()
        rigs.append(rig)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        for rig in rigs:
            rig.stop()
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


if __name__ == "__main__":
    main()
