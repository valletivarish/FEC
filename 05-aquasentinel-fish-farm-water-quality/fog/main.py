"""Runnable fog entrypoint: wires MQTT readings through all 3 fog nodes into the shared dispatcher."""
import logging
import os

import paho.mqtt.client as mqtt

from fog.dispatcher import AlertDispatcher
from fog.fog_life_support import LifeSupportFog
from fog.fog_ops import OpsFog
from fog.fog_toxicity import ToxicityFog
from fog.sensor_subscriber import subscribe_all

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MQTT_HOST = os.environ.get("AQUASENTINEL_MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("AQUASENTINEL_MQTT_PORT", "1883"))


def build_fog_nodes():
    return [LifeSupportFog(), ToxicityFog(), OpsFog()]


def make_reading_handler(fog_nodes, dispatcher: AlertDispatcher):
    def on_reading(reading: dict):
        for node in fog_nodes:
            events = node.on_reading(reading)
            for event in events:
                dispatcher.dispatch(event)

    return on_reading


def main():
    api_base_url = os.environ["AQUASENTINEL_API_BASE_URL"]
    dispatcher = AlertDispatcher(api_base_url)
    fog_nodes = build_fog_nodes()

    client = mqtt.Client()
    subscribe_all(client, make_reading_handler(fog_nodes, dispatcher))

    logger.info("connecting to MQTT broker at %s:%s", MQTT_HOST, MQTT_PORT)
    client.connect(MQTT_HOST, MQTT_PORT)
    client.loop_forever()


if __name__ == "__main__":
    main()
