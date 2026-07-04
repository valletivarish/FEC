import numpy as np

WINDOW_SIZE = 20
SLOPE_THRESHOLD = 0.5
SLOPE_CONSECUTIVE_REQUIRED = 5
DEVIATION_THRESHOLD = 8.0
DEVIATION_CONSECUTIVE_REQUIRED = 3


class ThermalGuard:
    """Combines a winding-temp trend (runaway) with a current/RPM sideband check
    so a fault surfaces whether it looks like slow drift or a sudden mismatch."""

    def __init__(self):
        self._winding_windows = {}
        self._latest_bearing = {}
        self._latest_current = {}
        self._latest_rpm = {}
        self._slope_streak = {}
        self._deviation_streak = {}

    def _ensure_asset(self, asset_id):
        if asset_id not in self._winding_windows:
            self._winding_windows[asset_id] = []
            self._slope_streak[asset_id] = 0
            self._deviation_streak[asset_id] = 0

    @staticmethod
    def _linear_slope(values):
        n = len(values)
        x = np.arange(n)
        y = np.array(values)
        x_mean = x.mean()
        y_mean = y.mean()
        denom = np.sum((x - x_mean) ** 2)
        if denom == 0:
            return 0.0
        return float(np.sum((x - x_mean) * (y - y_mean)) / denom)

    def on_reading(self, reading: dict) -> list:
        metric = reading.get('metric')
        asset_id = reading['assetId']
        self._ensure_asset(asset_id)

        if metric == 'thermal-bearing':
            self._latest_bearing[asset_id] = reading['value']
            return []
        if metric == 'electrical-current-rms':
            self._latest_current[asset_id] = reading['value']
            return []
        if metric == 'mech-rpm':
            self._latest_rpm[asset_id] = reading['value']
            return []
        if metric != 'thermal-winding':
            return []

        window = self._winding_windows[asset_id]
        window.append(reading['value'])
        if len(window) > WINDOW_SIZE:
            window.pop(0)

        verdict_tags = []
        slope = 0.0
        deviation = 0.0

        if len(window) == WINDOW_SIZE:
            slope = self._linear_slope(window)
            if slope > SLOPE_THRESHOLD:
                self._slope_streak[asset_id] += 1
            else:
                self._slope_streak[asset_id] = 0
            if self._slope_streak[asset_id] >= SLOPE_CONSECUTIVE_REQUIRED:
                verdict_tags.append('runaway')

        current_rms = self._latest_current.get(asset_id)
        rpm = self._latest_rpm.get(asset_id)
        if current_rms is not None and rpm is not None:
            expected_temp = 40 + 0.6 * current_rms + 0.01 * rpm
            latest_winding_temp = reading['value']
            deviation = abs(latest_winding_temp - expected_temp)

            if deviation > DEVIATION_THRESHOLD:
                self._deviation_streak[asset_id] += 1
            else:
                self._deviation_streak[asset_id] = 0
            if self._deviation_streak[asset_id] >= DEVIATION_CONSECUTIVE_REQUIRED:
                verdict_tags.append('sideband')

        if not verdict_tags:
            return []

        return [{
            'type': 'thermal_event',
            'asset_id': asset_id,
            'verdict_tags': verdict_tags,
            'slope': slope,
            'deviation': deviation,
            'timestamp': reading['timestamp'],
        }]
