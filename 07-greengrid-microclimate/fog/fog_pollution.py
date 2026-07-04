"""Rolling p95 exceedance watch for pm2-5 and ambient-noise, tracked independently per metric.

The p95 baseline is computed from the OLDER half of the window and the exceedance count from
the newer half — comparing a window against its own percentile caps exceedances at ~1 by
construction (p95 always sits between the top two order statistics of the same set), which made
EXCEEDANCE_WATCH mathematically unreachable. A disjoint baseline-vs-recent split is what makes a
genuine spike (most of the recent half sitting above the established baseline) detectable.
"""
from collections import deque

WINDOW_SIZE = 20
EXCEEDANCE_LOOKBACK = 10
BASELINE_SIZE = WINDOW_SIZE - EXCEEDANCE_LOOKBACK
EXCEEDANCE_THRESHOLD = 5
TRACKED_METRICS = ('pm2-5', 'ambient-noise')


class PollutionFog:
    def __init__(self):
        self._windows = {metric: {} for metric in TRACKED_METRICS}
        self._exceedance_active = {metric: {} for metric in TRACKED_METRICS}

    def on_reading(self, reading: dict) -> list:
        metric = reading['metric']
        if metric not in TRACKED_METRICS:
            return []

        station_id = reading['stationId']
        value = reading['value']
        timestamp = reading['timestamp']

        station_windows = self._windows[metric].setdefault(station_id, deque(maxlen=WINDOW_SIZE))
        station_windows.append(value)

        if len(station_windows) < WINDOW_SIZE:
            return []

        ordered = list(station_windows)
        baseline = ordered[:BASELINE_SIZE]
        recent = ordered[BASELINE_SIZE:]
        p95 = self._percentile_95(baseline)
        exceedance_count = sum(1 for v in recent if v > p95)

        active_map = self._exceedance_active[metric]
        was_active = active_map.get(station_id, False)
        is_active = exceedance_count >= EXCEEDANCE_THRESHOLD
        active_map[station_id] = is_active

        if is_active and not was_active:
            return [{
                'type': 'pollution_event',
                'station_id': station_id,
                'metric': metric,
                'rolling_p95': p95,
                'exceedance_count': exceedance_count,
                'timestamp': timestamp,
            }]
        return []

    @staticmethod
    def _percentile_95(values):
        sorted_values = sorted(values)
        n = len(sorted_values)
        index = 0.95 * (n - 1)
        lower = int(index)
        upper = min(lower + 1, n - 1)
        fraction = index - lower
        return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction
