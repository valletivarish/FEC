"""SafetyFog: bilge alarm detection and haversine-decimated GPS position tracking."""
import math

BILGE_WINDOW_SIZE = 5
BILGE_MIN_SAMPLES = 3
BILGE_SLOPE_THRESHOLD = 10
BILGE_HIGH_WATER_MM = 150
EARTH_RADIUS_M = 6371000
GPS_DISTANCE_THRESHOLD_M = 25
GPS_NORMAL_TICK_THRESHOLD = 12
GPS_ALARM_TICK_THRESHOLD = 1


class _VesselSafetyState:
    def __init__(self):
        self.bilge_window = []
        self.bilge_alarm_active = False
        self.last_position = None
        self.gps_tick_count = 0
        self.latest_heading_deg = None


class SafetyFog:
    def __init__(self):
        self._vessels = {}

    def _state_for(self, vessel_id: str) -> _VesselSafetyState:
        if vessel_id not in self._vessels:
            self._vessels[vessel_id] = _VesselSafetyState()
        return self._vessels[vessel_id]

    def on_reading(self, reading: dict) -> list[dict]:
        metric = reading['metric']
        vessel_id = reading['vesselId']
        state = self._state_for(vessel_id)

        if metric == 'hull-bilge-level':
            return self._handle_bilge(state, vessel_id, reading)
        if metric == 'nav-heading':
            state.latest_heading_deg = reading['value']
            return []
        if metric == 'nav-gps':
            return self._handle_gps(state, vessel_id, reading)
        return []

    def _handle_bilge(self, state: _VesselSafetyState, vessel_id: str, reading: dict) -> list[dict]:
        level = reading['value']
        state.bilge_window.append(level)
        if len(state.bilge_window) > BILGE_WINDOW_SIZE:
            state.bilge_window.pop(0)

        slope = None
        if len(state.bilge_window) >= BILGE_MIN_SAMPLES:
            slope = self._ols_slope(state.bilge_window)

        rising_fast = slope is not None and slope > BILGE_SLOPE_THRESHOLD
        high_water = level > BILGE_HIGH_WATER_MM
        alarm_condition = rising_fast or high_water

        was_active = state.bilge_alarm_active
        state.bilge_alarm_active = alarm_condition

        if alarm_condition:
            return [{
                'type': 'bilge_alarm',
                'vesselId': vessel_id,
                'alarmActive': True,
                'level': level,
                'slope': slope,
                'timestamp': reading['timestamp'],
            }]
        if was_active and not alarm_condition:
            return [{
                'type': 'bilge_alarm',
                'vesselId': vessel_id,
                'alarmActive': False,
                'level': level,
                'slope': slope,
                'timestamp': reading['timestamp'],
            }]
        return []

    @staticmethod
    def _ols_slope(values: list) -> float:
        n = len(values)
        x_mean = (n - 1) / 2
        y_mean = sum(values) / n
        numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
        denominator = sum((i - x_mean) ** 2 for i in range(n))
        return numerator / denominator

    def _handle_gps(self, state: _VesselSafetyState, vessel_id: str, reading: dict) -> list[dict]:
        lat = reading['value']['lat']
        lon = reading['value']['lon']

        if state.last_position is None:
            state.last_position = (lat, lon)
            state.gps_tick_count = 0
            return [self._gps_event(vessel_id, lat, lon, state, reading['timestamp'])]

        distance_m = self._haversine(state.last_position[0], state.last_position[1], lat, lon)
        state.gps_tick_count += 1
        tick_threshold = GPS_ALARM_TICK_THRESHOLD if state.bilge_alarm_active else GPS_NORMAL_TICK_THRESHOLD

        if distance_m >= GPS_DISTANCE_THRESHOLD_M or state.gps_tick_count >= tick_threshold:
            state.last_position = (lat, lon)
            state.gps_tick_count = 0
            return [self._gps_event(vessel_id, lat, lon, state, reading['timestamp'])]
        return []

    @staticmethod
    def _gps_event(vessel_id: str, lat: float, lon: float, state: _VesselSafetyState, timestamp: str) -> dict:
        return {
            'type': 'gps_track_event',
            'vesselId': vessel_id,
            'lat': lat,
            'lon': lon,
            'headingDeg': state.latest_heading_deg,
            'timestamp': timestamp,
        }

    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        d_phi = math.radians(lat2 - lat1)
        d_lambda = math.radians(lon2 - lon1)
        a = (math.sin(d_phi / 2) ** 2
             + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return EARTH_RADIUS_M * c
