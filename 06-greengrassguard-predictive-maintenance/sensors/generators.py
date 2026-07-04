"""Per-metric value generators: bounded random walks over the ranges in the fog contract.

Each function takes the previous value (or None for a first call) and returns the next
plausible value, clamped to the metric's physical range so fog nodes never see garbage.
"""
import math
import random

# (min, max) bounds per the shared contract; step is the max per-tick random-walk delta.
_RANGES = {
    "vibe-axial": (0.5, 12.0),
    "vibe-radial": (0.5, 15.0),
    "acoustic-emission": (40.0, 110.0),
    "thermal-winding": (20.0, 155.0),
    "thermal-bearing": (15.0, 120.0),
    "electrical-current-rms": (2.0, 85.0),
    "mech-rpm": (0.0, 3600.0),
    "hydraulic-discharge-pressure": (0.5, 16.0),
    "hydraulic-flow": (0.0, 220.0),
    "env-humidity": (10.0, 95.0),
}

VIBE_WINDOW_SIZE = 32
# Plausible bearing defect frequency band for a synthetic waveform (Hz), not tied to any
# real asset spec since this is a demo signal generator, not measured hardware data.
_BEARING_FREQ_HZ = 120.0
_SAMPLE_RATE_HZ = 1000.0


def _walk(previous, lo, hi, step_frac=0.03, seed_frac=0.3):
    """Shared random-walk core: step is a fraction of the range, clamped to [lo, hi]."""
    span = hi - lo
    if previous is None:
        return lo + span * seed_frac
    step = span * step_frac
    nxt = previous + random.uniform(-step, step)
    return min(hi, max(lo, nxt))


def next_vibe_axial(previous):
    lo, hi = _RANGES["vibe-axial"]
    return _walk(previous, lo, hi)


def next_vibe_radial(previous):
    lo, hi = _RANGES["vibe-radial"]
    return _walk(previous, lo, hi)


def next_acoustic_emission(previous):
    lo, hi = _RANGES["acoustic-emission"]
    return _walk(previous, lo, hi)


def next_thermal_winding(previous):
    lo, hi = _RANGES["thermal-winding"]
    # Thermal mass makes real windings drift slowly, so use a smaller step fraction.
    return _walk(previous, lo, hi, step_frac=0.015)


def next_thermal_bearing(previous):
    lo, hi = _RANGES["thermal-bearing"]
    return _walk(previous, lo, hi, step_frac=0.015)


def next_electrical_current_rms(previous):
    lo, hi = _RANGES["electrical-current-rms"]
    return _walk(previous, lo, hi)


def next_mech_rpm(previous):
    lo, hi = _RANGES["mech-rpm"]
    # Motors tend to sit near a running speed rather than drift far tick to tick.
    return _walk(previous, lo, hi, step_frac=0.01, seed_frac=0.5)


def next_hydraulic_discharge_pressure(previous):
    lo, hi = _RANGES["hydraulic-discharge-pressure"]
    return _walk(previous, lo, hi)


def next_hydraulic_flow(previous):
    lo, hi = _RANGES["hydraulic-flow"]
    return _walk(previous, lo, hi)


def next_env_humidity(previous):
    lo, hi = _RANGES["env-humidity"]
    # Ambient humidity changes gradually, so use a smaller step fraction.
    return _walk(previous, lo, hi, step_frac=0.02)


def vibe_window(value, metric):
    """32 raw synthetic samples so VibeCore has a real waveform to window/FFT.

    Sine at a plausible bearing frequency, amplitude scaled to the current scalar
    reading, plus small noise so consecutive windows aren't perfectly periodic.
    """
    lo, hi = _RANGES[metric]
    amplitude = value / hi if hi else 0.0
    samples = []
    for i in range(VIBE_WINDOW_SIZE):
        t = i / _SAMPLE_RATE_HZ
        base = amplitude * math.sin(2 * math.pi * _BEARING_FREQ_HZ * t)
        noise = random.uniform(-0.05, 0.05) * amplitude
        samples.append(base + noise)
    return samples


GENERATORS = {
    "vibe-axial": next_vibe_axial,
    "vibe-radial": next_vibe_radial,
    "acoustic-emission": next_acoustic_emission,
    "thermal-winding": next_thermal_winding,
    "thermal-bearing": next_thermal_bearing,
    "electrical-current-rms": next_electrical_current_rms,
    "mech-rpm": next_mech_rpm,
    "hydraulic-discharge-pressure": next_hydraulic_discharge_pressure,
    "hydraulic-flow": next_hydraulic_flow,
    "env-humidity": next_env_humidity,
}

VIBE_METRICS = ("vibe-axial", "vibe-radial")
