"""Irrigation, frost, and disease risk from the latest known soil/weather snapshot per station."""

IRRIGATION_MOISTURE_THRESHOLD = 20.0
FROST_TEMP_WATCH_MAX = 2.0
FROST_TEMP_WARNING_MAX = 0.0
FROST_LEAF_WETNESS_THRESHOLD = 4
DISEASE_LEAF_WETNESS_THRESHOLD = 8
DISEASE_CONSECUTIVE_REQUIRED = 3
DISEASE_TEMP_BAND = (15.0, 27.0)


class SoilFog:
    def __init__(self):
        # latest known value per metric, per station
        self._latest = {}
        # consecutive readings with leaf-wetness >= threshold, per station
        self._high_wetness_streak = {}
        # last-known active state per (station, risk) so we only dispatch on rising edge
        self._active_flags = {}

    def on_reading(self, reading: dict) -> list:
        station_id = reading['stationId']
        metric = reading['metric']
        value = reading['value']
        timestamp = reading['timestamp']

        if metric not in ('soil-moisture', 'air-temperature', 'rainfall', 'leaf-wetness'):
            return []

        station_values = self._latest.setdefault(station_id, {})
        station_values[metric] = value

        if metric == 'leaf-wetness':
            streak = self._high_wetness_streak.get(station_id, 0)
            if value >= DISEASE_LEAF_WETNESS_THRESHOLD:
                streak += 1
            else:
                streak = 0
            self._high_wetness_streak[station_id] = streak

        return self._evaluate(station_id, timestamp)

    def _evaluate(self, station_id: str, timestamp: str) -> list:
        values = self._latest.get(station_id, {})
        soil_moisture = values.get('soil-moisture')
        air_temperature = values.get('air-temperature')
        rainfall = values.get('rainfall')
        leaf_wetness = values.get('leaf-wetness')

        flags = self._active_flags.setdefault(station_id, {})
        events = []

        irrigation_active = (
            soil_moisture is not None and rainfall is not None
            and soil_moisture < IRRIGATION_MOISTURE_THRESHOLD and rainfall == 0
        )
        events.extend(self._transition_event(
            flags, station_id, 'irrigation_need', irrigation_active, timestamp, severity=None
        ))

        frost_severity = None
        if air_temperature is not None and leaf_wetness is not None:
            if air_temperature <= FROST_TEMP_WATCH_MAX and leaf_wetness >= FROST_LEAF_WETNESS_THRESHOLD:
                frost_severity = 'warning' if air_temperature < FROST_TEMP_WARNING_MAX else 'watch'
        frost_active = frost_severity is not None
        events.extend(self._transition_event(
            flags, station_id, 'frost_risk', frost_active, timestamp, severity=frost_severity
        ))

        streak = self._high_wetness_streak.get(station_id, 0)
        disease_active = (
            streak >= DISEASE_CONSECUTIVE_REQUIRED
            and air_temperature is not None
            and DISEASE_TEMP_BAND[0] <= air_temperature <= DISEASE_TEMP_BAND[1]
        )
        events.extend(self._transition_event(
            flags, station_id, 'disease_risk', disease_active, timestamp, severity=None
        ))

        return events

    @staticmethod
    def _transition_event(flags, station_id, risk_name, is_active, timestamp, severity):
        was_active = flags.get(risk_name, False)
        flags[risk_name] = is_active
        if is_active and not was_active:
            return [{
                'type': 'soil_event',
                'station_id': station_id,
                'risk': risk_name,
                'severity': severity,
                'timestamp': timestamp,
            }]
        return []
