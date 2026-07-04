"""Storm-risk detection: vector-averaged wind, pressure trend, and a weighted composite score."""
import math
from collections import deque

WINDOW_SIZE = 10
STORM_RISK_THRESHOLD = 70

# reference scales the component formulas clamp against, not hard physical limits
PRESSURE_DROP_REFERENCE_SLOPE = -2.0  # hPa/sample considered a "full" pressure-drop signal
WIND_MAGNITUDE_REFERENCE = 25.0  # m/s
RAINFALL_REFERENCE = 40.0  # mm/h
GUST_VARIANCE_REFERENCE = 10.0  # m/s stddev

# UV drop is a secondary storm cue: cloud buildup ahead of a cell cuts UV well before rain arrives
UV_INDEX_CLEAR_SKY_REFERENCE = 8.0  # index value treated as a cloudless baseline


class WeatherFog:
    def __init__(self):
        # per-station rolling windows: wind (speed, direction) pairs and pressure samples
        self._wind_windows = {}
        self._pressure_windows = {}
        self._latest_rainfall = {}
        self._latest_uv_index = {}
        self._storm_active = {}

        # readings pending a partner value before they can join the wind window
        self._pending_wind_speed = {}
        self._pending_wind_direction = {}

    def on_reading(self, reading: dict) -> list:
        station_id = reading['stationId']
        metric = reading['metric']
        value = reading['value']
        timestamp = reading['timestamp']

        if metric == 'wind-speed':
            self._pending_wind_speed[station_id] = value
        elif metric == 'wind-direction':
            self._pending_wind_direction[station_id] = value
        elif metric == 'barometric-pressure':
            window = self._pressure_windows.setdefault(station_id, deque(maxlen=WINDOW_SIZE))
            window.append(value)
        elif metric == 'rainfall':
            self._latest_rainfall[station_id] = value
        elif metric == 'uv-index':
            self._latest_uv_index[station_id] = value
        else:
            return []

        # only push into the wind window once both speed and direction are known together
        if station_id in self._pending_wind_speed and station_id in self._pending_wind_direction:
            wind_window = self._wind_windows.setdefault(station_id, deque(maxlen=WINDOW_SIZE))
            wind_window.append((
                self._pending_wind_speed.pop(station_id),
                self._pending_wind_direction.pop(station_id),
            ))

        return self._evaluate(station_id, timestamp)

    def _evaluate(self, station_id: str, timestamp: str) -> list:
        wind_window = self._wind_windows.get(station_id)
        pressure_window = self._pressure_windows.get(station_id)

        if not wind_window or not pressure_window or len(pressure_window) < 2:
            return []

        mean_speed, mean_direction = self._vector_average_wind(wind_window)
        slope = self._barometric_slope(pressure_window)
        latest_rainfall = self._latest_rainfall.get(station_id, 0.0)
        gust_stddev = self._stddev([s for s, _ in wind_window])
        # no UV reading yet defaults to clear-sky, so an absent sensor never manufactures storm signal
        latest_uv_index = self._latest_uv_index.get(station_id, UV_INDEX_CLEAR_SKY_REFERENCE)

        score = self._storm_risk_score(slope, mean_speed, latest_rainfall, gust_stddev, latest_uv_index)

        was_active = self._storm_active.get(station_id, False)
        is_active = score >= STORM_RISK_THRESHOLD
        self._storm_active[station_id] = is_active

        if is_active and not was_active:
            return [{
                'type': 'weather_event',
                'station_id': station_id,
                'storm_risk_score': score,
                'mean_wind_speed': mean_speed,
                'mean_wind_direction': mean_direction,
                'barometric_slope': slope,
                'uv_index': latest_uv_index,
                'timestamp': timestamp,
            }]
        return []

    @staticmethod
    def _vector_average_wind(window):
        u_components = []
        v_components = []
        for speed, direction in window:
            u_components.append(speed * math.sin(math.radians(direction)))
            v_components.append(speed * math.cos(math.radians(direction)))

        u_mean = sum(u_components) / len(u_components)
        v_mean = sum(v_components) / len(v_components)

        mean_speed = math.sqrt(u_mean ** 2 + v_mean ** 2)
        mean_direction = math.degrees(math.atan2(u_mean, v_mean)) % 360
        return mean_speed, mean_direction

    @staticmethod
    def _barometric_slope(window):
        n = len(window)
        xs = list(range(n))
        ys = list(window)
        x_mean = sum(xs) / n
        y_mean = sum(ys) / n

        numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
        denominator = sum((x - x_mean) ** 2 for x in xs)
        if denominator == 0:
            return 0.0
        return numerator / denominator

    @staticmethod
    def _stddev(values):
        n = len(values)
        if n < 2:
            return 0.0
        mean = sum(values) / n
        variance = sum((v - mean) ** 2 for v in values) / n
        return math.sqrt(variance)

    @staticmethod
    def _storm_risk_score(slope, mean_speed, latest_rainfall, gust_stddev, latest_uv_index):
        # more negative slope means faster pressure drop, i.e. higher storm signal
        pressure_drop_component = _clamp(
            (max(0.0, -slope) / abs(PRESSURE_DROP_REFERENCE_SLOPE)) * 100, 0, 100
        )
        wind_magnitude_component = _clamp((mean_speed / WIND_MAGNITUDE_REFERENCE) * 100, 0, 100)
        rainfall_rate_component = _clamp((latest_rainfall / RAINFALL_REFERENCE) * 100, 0, 100)
        gust_variance_component = _clamp((gust_stddev / GUST_VARIANCE_REFERENCE) * 100, 0, 100)
        # UV falling below the clear-sky reference means cloud cover is building ahead of a cell
        uv_drop_component = _clamp(
            (max(0.0, UV_INDEX_CLEAR_SKY_REFERENCE - latest_uv_index) / UV_INDEX_CLEAR_SKY_REFERENCE) * 100,
            0, 100,
        )

        score = (
            pressure_drop_component * 0.40
            + wind_magnitude_component * 0.25
            + rainfall_rate_component * 0.25
            + gust_variance_component * 0.10
            + uv_drop_component * 0.05
        )
        return _clamp(score, 0, 100)


def _clamp(value, low, high):
    return max(low, min(high, value))
