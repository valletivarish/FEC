"""CLI entrypoint wiring MQTT readings into the three fog nodes."""
from __future__ import annotations

import logging
import os
import signal
import sys
import threading

from dispatcher import AdvisoryDispatcher
from fog_comfort import COMFORT_SENSORS, FogComfort
from fog_gases import GAS_SENSORS, FogGases
from fog_particulate import PARTICULATE_SENSORS, FogParticulate
from mqtt_subscriber import subscribe_to_readings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    broker_url = os.environ.get("MQTT_BROKER_URL", "tcp://localhost:1883")
    api_base_url = os.environ.get("API_BASE_URL")
    if not api_base_url:
        logger.error("API_BASE_URL must be set")
        sys.exit(1)

    dispatcher = AdvisoryDispatcher(api_base_url)
    particulate_node = FogParticulate(dispatcher)
    gases_node = FogGases(dispatcher)
    comfort_node = FogComfort(dispatcher)

    def on_reading(reading: dict) -> None:
        sensor = reading.get("topic")
        # occupancy_pir feeds only comfort; every other topic routes by its own set.
        if sensor in PARTICULATE_SENSORS:
            particulate_node.handle_reading(reading)
        if sensor in GAS_SENSORS:
            gases_node.handle_reading(reading)
        if sensor in COMFORT_SENSORS:
            comfort_node.handle_reading(reading)

    client = subscribe_to_readings(broker_url, on_reading)
    logger.info("fog nodes running, subscribed via %s", broker_url)

    stop_event = threading.Event()

    def _handle_shutdown(signum: int, frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

    stop_event.wait()
    client.loop_stop()
    dispatcher.stop()


if __name__ == "__main__":
    main()
