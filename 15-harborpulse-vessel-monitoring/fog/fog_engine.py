"""EngineFog: vibration-derived bearing wear detection plus engine context tracking."""
from collections import deque

import numpy as np

WINDOW_SIZE = 64
SAMPLE_RATE_HZ = 64.0
BASELINE_MAXLEN = 30
BASELINE_MIN_SAMPLES = 10
BEARING_BAND_LOW_HZ = 10
BEARING_BAND_HIGH_HZ = 20


class _VesselEngineState:
    def __init__(self):
        self.vibration_window = []
        self.baseline = deque(maxlen=BASELINE_MAXLEN)
        self.engine_rpm = None
        self.coolant_temp_c = None
        self.oil_pressure_kpa = None
        self.fuel_flow_lph = None


class EngineFog:
    def __init__(self):
        self._vessels = {}

    def _state_for(self, vessel_id: str) -> _VesselEngineState:
        if vessel_id not in self._vessels:
            self._vessels[vessel_id] = _VesselEngineState()
        return self._vessels[vessel_id]

    def on_reading(self, reading: dict) -> list[dict]:
        metric = reading['metric']
        vessel_id = reading['vesselId']
        state = self._state_for(vessel_id)

        if metric == 'engine-rpm':
            state.engine_rpm = reading['value']
            return []
        if metric == 'engine-coolant-temp':
            state.coolant_temp_c = reading['value']
            return []
        if metric == 'engine-oil-pressure':
            state.oil_pressure_kpa = reading['value']
            return []
        if metric == 'engine-fuel-flow':
            state.fuel_flow_lph = reading['value']
            return []
        if metric != 'engine-vibration-raw':
            return []

        state.vibration_window.append(reading['value'])
        if len(state.vibration_window) < WINDOW_SIZE:
            return []

        samples = np.array(state.vibration_window)
        state.vibration_window = []

        rms = float(np.sqrt(np.mean(samples ** 2)))
        bearing_wear_energy = self._bearing_wear_energy(samples)
        degraded_bearing = self._check_degraded(state, bearing_wear_energy)
        state.baseline.append(bearing_wear_energy)

        return [{
            'type': 'engine_health_event',
            'vesselId': vessel_id,
            'rms': rms,
            'bearingWearEnergy': bearing_wear_energy,
            'degradedBearing': degraded_bearing,
            'engineRpm': state.engine_rpm,
            'coolantTempC': state.coolant_temp_c,
            'oilPressureKpa': state.oil_pressure_kpa,
            'fuelFlowLph': state.fuel_flow_lph,
            'timestamp': reading['timestamp'],
        }]

    @staticmethod
    def _bearing_wear_energy(samples: np.ndarray) -> float:
        windowed = samples * np.hanning(WINDOW_SIZE)
        fft = np.fft.rfft(windowed)
        psd = np.abs(fft) ** 2 / WINDOW_SIZE
        freqs = np.fft.rfftfreq(WINDOW_SIZE, d=1 / SAMPLE_RATE_HZ)
        band_mask = (freqs >= BEARING_BAND_LOW_HZ) & (freqs <= BEARING_BAND_HIGH_HZ)
        return float(psd[band_mask].sum())

    @staticmethod
    def _check_degraded(state: _VesselEngineState, current_energy: float) -> bool:
        if len(state.baseline) < BASELINE_MIN_SAMPLES:
            return False
        baseline_mean = float(np.mean(state.baseline))
        baseline_std = float(np.std(state.baseline))
        if baseline_std == 0:
            return False
        return current_energy > baseline_mean + 3 * baseline_std
