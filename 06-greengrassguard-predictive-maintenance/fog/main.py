import os

import paho.mqtt.client as mqtt

from dispatcher import DiagnosisDispatcher
from fog_hydraulic import HydraulicFog
from fog_thermal_guard import ThermalGuard
from fog_vibe_core import VibeCore
from sensor_subscriber import subscribe_all

MQTT_BROKER_HOST = os.environ.get('MQTT_BROKER_HOST', 'localhost')
MQTT_BROKER_PORT = int(os.environ.get('MQTT_BROKER_PORT', '1883'))

# electrical-current-rms feeds both ThermalGuard's sideband check and
# HydraulicFog's efficiency formula, so it fans out to two nodes, not one.
THERMAL_METRICS = {'thermal-winding', 'thermal-bearing', 'electrical-current-rms', 'mech-rpm'}
HYDRAULIC_METRICS = {'hydraulic-discharge-pressure', 'hydraulic-flow', 'electrical-current-rms', 'env-humidity'}
# acoustic-emission corroborates the vibration bands VibeCore already scores, so
# it routes there rather than becoming a fourth fog node for one metric.
VIBE_METRICS = {'acoustic-emission'}


def build_router(vibe_core, thermal_guard, hydraulic_fog, dispatcher):
    def on_reading(reading):
        metric = reading.get('metric', '')
        events = []

        if metric.startswith('vibe-') or metric in VIBE_METRICS:
            events.extend(vibe_core.on_reading(reading))
        if metric in THERMAL_METRICS:
            events.extend(thermal_guard.on_reading(reading))
        if metric in HYDRAULIC_METRICS:
            events.extend(hydraulic_fog.on_reading(reading))

        for event in events:
            dispatcher.dispatch(event)

    return on_reading


def main():
    api_base_url = os.environ['GUARD_API_BASE_URL']
    dispatcher = DiagnosisDispatcher(api_base_url)

    vibe_core = VibeCore()
    thermal_guard = ThermalGuard()
    hydraulic_fog = HydraulicFog()

    on_reading = build_router(vibe_core, thermal_guard, hydraulic_fog, dispatcher)

    client = mqtt.Client()
    # subscribe must happen on_connect: calling subscribe() beforehand sends nothing
    # over the wire since there's no broker connection yet (paho returns MQTT_ERR_NO_CONN
    # and silently drops it, it isn't queued for replay once connected)
    client.on_connect = lambda c, userdata, flags, rc: subscribe_all(c, on_reading)
    client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT)
    client.loop_forever()


if __name__ == '__main__':
    main()
