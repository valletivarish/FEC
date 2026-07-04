import statistics

WINDOW_SIZE = 20
CONVERSION_CONSTANT = 12.0
CAVITATION_CV_THRESHOLD = 0.15
COMMISSIONING_BASELINE_BAR = 10.0
CAVITATION_PRESSURE_RATIO = 0.7
LOW_EFFICIENCY_THRESHOLD = 0.5

# High ambient humidity promotes water ingress into the reservoir, which lowers
# the fluid's saturation pressure and makes cavitation easier to trigger, so a
# humid environment relaxes the pressure ratio that alone would flag it.
HIGH_HUMIDITY_THRESHOLD_PCT = 80.0
HUMID_CAVITATION_PRESSURE_RATIO = 0.85


class HydraulicFog:
    """Only dispatches on cavitation risk or poor efficiency, not every pressure
    reading, so the backend sees signal rather than a stream of routine numbers."""

    def __init__(self):
        self._flow_windows = {}
        self._latest_current = {}
        self._latest_humidity = {}

    def _ensure_asset(self, asset_id):
        if asset_id not in self._flow_windows:
            self._flow_windows[asset_id] = []

    def on_reading(self, reading: dict) -> list:
        metric = reading.get('metric')
        asset_id = reading['assetId']
        self._ensure_asset(asset_id)

        if metric == 'electrical-current-rms':
            self._latest_current[asset_id] = reading['value']
            return []
        if metric == 'env-humidity':
            self._latest_humidity[asset_id] = reading['value']
            return []
        if metric == 'hydraulic-flow':
            window = self._flow_windows[asset_id]
            window.append(reading['value'])
            if len(window) > WINDOW_SIZE:
                window.pop(0)
            return []
        if metric != 'hydraulic-discharge-pressure':
            return []

        pressure = reading['value']
        current_rms = self._latest_current.get(asset_id)
        window = self._flow_windows[asset_id]

        if current_rms is None or not window:
            return []

        flow_mean = statistics.mean(window)
        efficiency = (pressure * flow_mean) / (current_rms * CONVERSION_CONSTANT)

        flow_cv = 0.0
        if flow_mean != 0:
            flow_stdev = statistics.pstdev(window) if len(window) > 1 else 0.0
            flow_cv = flow_stdev / flow_mean

        humidity = self._latest_humidity.get(asset_id)
        humid_environment = humidity is not None and humidity >= HIGH_HUMIDITY_THRESHOLD_PCT
        pressure_ratio = HUMID_CAVITATION_PRESSURE_RATIO if humid_environment else CAVITATION_PRESSURE_RATIO

        cavitation_suspected = (
            flow_cv > CAVITATION_CV_THRESHOLD
            and pressure < COMMISSIONING_BASELINE_BAR * pressure_ratio
        )

        if not cavitation_suspected and efficiency >= LOW_EFFICIENCY_THRESHOLD:
            return []

        return [{
            'type': 'hydraulic_event',
            'asset_id': asset_id,
            'efficiency': efficiency,
            'cavitation_suspected': cavitation_suspected,
            'flow_cv': flow_cv,
            'pressure': pressure,
            'timestamp': reading['timestamp'],
            'humidity_pct': humidity,
            'humid_environment': humid_environment,
        }]
