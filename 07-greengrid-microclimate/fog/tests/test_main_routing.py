from fog_pollution import PollutionFog
from fog_soil import SoilFog
from fog_weather import WeatherFog
from main import STATION_IDS, build_router
from node_health import FogNodeHealth


class RecordingDispatcher:
    def __init__(self):
        self.dispatched = []

    def dispatch(self, event):
        self.dispatched.append(event)
        return True


def make_reading(station_id, metric, value, timestamp='2026-01-01T00:00:00Z'):
    return {
        'stationId': station_id,
        'metric': metric,
        'value': value,
        'unit': '',
        'timestamp': timestamp,
    }


def make_health_by_node():
    # mirrors main()'s own construction so routing tests exercise the real health-tracking path
    return {
        'weather': FogNodeHealth('weather', STATION_IDS),
        'soil': FogNodeHealth('soil', STATION_IDS),
        'pollution': FogNodeHealth('pollution', STATION_IDS),
    }


def test_rainfall_and_air_temperature_feed_both_weather_and_soil_fog():
    weather_fog = WeatherFog()
    soil_fog = SoilFog()
    pollution_fog = PollutionFog()
    dispatcher = RecordingDispatcher()
    on_reading = build_router(weather_fog, soil_fog, pollution_fog, dispatcher, make_health_by_node())

    on_reading(make_reading('station-quad', 'rainfall', 0.0))

    # rainfall must be tracked inside both fog nodes' internal state
    assert weather_fog._latest_rainfall['station-quad'] == 0.0
    assert soil_fog._latest['station-quad']['rainfall'] == 0.0


def test_pm25_only_routes_to_pollution_fog():
    weather_fog = WeatherFog()
    soil_fog = SoilFog()
    pollution_fog = PollutionFog()
    dispatcher = RecordingDispatcher()
    on_reading = build_router(weather_fog, soil_fog, pollution_fog, dispatcher, make_health_by_node())

    on_reading(make_reading('station-quad', 'pm2-5', 12.0))

    assert 'station-quad' in pollution_fog._windows['pm2-5']
    assert 'station-quad' not in soil_fog._latest
    assert 'station-quad' not in weather_fog._latest_rainfall


def test_dispatcher_receives_events_returned_by_fog_nodes():
    weather_fog = WeatherFog()
    soil_fog = SoilFog()
    pollution_fog = PollutionFog()
    dispatcher = RecordingDispatcher()
    on_reading = build_router(weather_fog, soil_fog, pollution_fog, dispatcher, make_health_by_node())

    on_reading(make_reading('station-quad', 'rainfall', 0.0))
    on_reading(make_reading('station-quad', 'leaf-wetness', 5.0))
    on_reading(make_reading('station-quad', 'soil-moisture', 10.0))
    on_reading(make_reading('station-quad', 'air-temperature', -1.0))

    types = [e['type'] for e in dispatcher.dispatched]
    assert 'soil_event' in types
