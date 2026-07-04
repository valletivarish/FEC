"""Runnable fog entrypoint: wires MQTT readings to all 3 fog nodes and dispatches their events."""
import os

import paho.mqtt.client as mqtt

from dispatcher import FleetEventDispatcher
from fog_engine import EngineFog
from fog_safety import SafetyFog
from fog_sea_state import SeaStateFog
from sensor_subscriber import subscribe_all

MQTT_HOST = os.environ.get('MQTT_HOST', 'localhost')
MQTT_PORT = int(os.environ.get('MQTT_PORT', '1883'))


def build_router(engine_fog, sea_state_fog, safety_fog, dispatcher):
    def on_reading(reading: dict):
        # every reading is offered to all 3 nodes; each ignores metrics it doesn't track
        events = []
        events.extend(engine_fog.on_reading(reading))
        events.extend(sea_state_fog.on_reading(reading))
        events.extend(safety_fog.on_reading(reading))

        for event in events:
            dispatcher.dispatch(event)

    return on_reading


def main():
    api_base_url = os.environ['HARBORPULSE_API_BASE_URL']
    dispatcher = FleetEventDispatcher(api_base_url)

    engine_fog = EngineFog()
    sea_state_fog = SeaStateFog()
    safety_fog = SafetyFog()

    on_reading = build_router(engine_fog, sea_state_fog, safety_fog, dispatcher)

    client = mqtt.Client()
    # connect before subscribing: paho 1.6.1's subscribe() silently no-ops (MQTT_ERR_NO_CONN)
    # rather than queuing when called on a not-yet-connected client
    client.connect(MQTT_HOST, MQTT_PORT)
    subscribe_all(client, on_reading)
    client.loop_forever()


if __name__ == '__main__':
    main()
