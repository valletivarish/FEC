"""Runnable fog entrypoint: wires MQTT readings to the 3 fog nodes and dispatches their events."""
import os
import threading
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from dispatcher import StationDispatcher
from fog_pollution import PollutionFog
from fog_soil import SoilFog
from fog_weather import WeatherFog
from node_health import FogNodeHealth
from sensor_subscriber import subscribe_all

WEATHER_METRICS = {'wind-speed', 'wind-direction', 'barometric-pressure', 'rainfall', 'uv-index'}
SOIL_METRICS = {'soil-moisture', 'air-temperature', 'rainfall', 'leaf-wetness'}
POLLUTION_METRICS = {'pm2-5', 'ambient-noise'}
STATION_IDS = ['station-quad', 'station-north-lawn', 'station-arboretum']

MQTT_HOST = os.environ.get('MQTT_HOST', 'localhost')
MQTT_PORT = int(os.environ.get('MQTT_PORT', '1883'))
HEALTH_REPORT_INTERVAL_S = float(os.environ.get('GREENGRID_HEALTH_REPORT_INTERVAL_S', '15'))


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def build_router(weather_fog, soil_fog, pollution_fog, dispatcher, health_by_node):
    def on_reading(reading: dict):
        metric = reading['metric']
        timestamp = reading.get('timestamp', _now_iso())
        events = []

        for metric_set, fog_node, health in (
            (WEATHER_METRICS, weather_fog, health_by_node['weather']),
            (SOIL_METRICS, soil_fog, health_by_node['soil']),
            (POLLUTION_METRICS, pollution_fog, health_by_node['pollution']),
        ):
            if metric not in metric_set:
                continue
            health.record_received()
            node_events = fog_node.on_reading(reading)
            health.record_processed(len(node_events))
            events.extend(node_events)
            if node_events:
                health.record_dispatched(timestamp, count=len(node_events))

        for event in events:
            dispatcher.dispatch(event)

    return on_reading


def _health_report_loop(health_by_node, dispatcher, stop_event):
    """Dispatches each node's real self-measured CPU/memory/counters/queue depth on the
    same HTTP -> backend path as domain events, at a fixed interval, until stopped."""
    while not stop_event.wait(HEALTH_REPORT_INTERVAL_S):
        for health in health_by_node.values():
            dispatcher.dispatch(health.to_health_event(_now_iso()))


def main():
    api_base_url = os.environ['GREENGRID_API_BASE_URL']
    dispatcher = StationDispatcher(api_base_url)

    weather_fog = WeatherFog()
    soil_fog = SoilFog()
    pollution_fog = PollutionFog()

    health_by_node = {
        'weather': FogNodeHealth('weather', STATION_IDS),
        'soil': FogNodeHealth('soil', STATION_IDS),
        'pollution': FogNodeHealth('pollution', STATION_IDS),
    }

    on_reading = build_router(weather_fog, soil_fog, pollution_fog, dispatcher, health_by_node)

    stop_event = threading.Event()
    health_thread = threading.Thread(
        target=_health_report_loop, args=(health_by_node, dispatcher, stop_event), daemon=True
    )
    health_thread.start()

    client = mqtt.Client()
    # subscribe() before the broker handshake completes is a silent no-op (paho returns
    # MQTT_ERR_NO_CONN but raises nothing), so the actual subscribe must wait for on_connect
    client.on_connect = lambda c, userdata, flags, rc: subscribe_all(c, on_reading)
    client.connect(MQTT_HOST, MQTT_PORT)
    client.loop_forever()


if __name__ == '__main__':
    main()
