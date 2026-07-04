"""Per-metric bounded random-walk generators for AquaSentinel pond sensors.

Each function takes the previous value (or None for a cold start) and returns
a plausible next value, clamped to the metric's real-world range so a long-running
walk can never drift outside physically sensible bounds.
"""

import random


def _walk(previous, low, high, start, step):
    """Shared bounded random-walk step: nudge previous by +-step, clamp to [low, high]."""
    if previous is None:
        return start
    nxt = previous + random.uniform(-step, step)
    return max(low, min(high, nxt))


def next_dissolved_oxygen(previous):
    # mg/L, 0.5-12; typical healthy pond sits mid-range so start there
    return _walk(previous, 0.5, 12.0, 7.0, 0.3)


def next_water_temperature(previous):
    # degC, 10-34; drifts slowly, temperature swings are gradual in a pond body
    return _walk(previous, 10.0, 34.0, 24.0, 0.2)


def next_ph(previous):
    # pH, 5.5-9.5; buffered water so small step size
    return _walk(previous, 5.5, 9.5, 7.5, 0.05)


def next_salinity(previous):
    # ppt, 0-35; changes slowly unless there's a water exchange event
    return _walk(previous, 0.0, 35.0, 5.0, 0.2)


def next_turbidity(previous):
    # NTU, 0-400; can spike with feeding/waste, larger step range
    return _walk(previous, 0.0, 400.0, 20.0, 8.0)


def next_ammonia_nh3_total(previous):
    # mg/L TAN, 0-8; builds up slowly from waste, small steps
    return _walk(previous, 0.0, 8.0, 0.3, 0.05)


def next_nitrite_no2(previous):
    # mg/L, 0-5; byproduct of ammonia oxidation, similarly slow-moving
    return _walk(previous, 0.0, 5.0, 0.1, 0.03)


def next_orp(previous):
    # mV, -50 to 450; reflects overall water redox state
    return _walk(previous, -50.0, 450.0, 200.0, 10.0)


def next_water_level(previous):
    # cm, 0-250; mostly stable, occasional evaporation/refill drift
    return _walk(previous, 0.0, 250.0, 150.0, 1.5)


def next_feeder_load_cell(previous):
    # g/cycle, 0-5000; feeder dispenses in discrete bursts, so wider step
    return _walk(previous, 0.0, 5000.0, 500.0, 150.0)


GENERATORS = {
    "dissolved-oxygen": next_dissolved_oxygen,
    "water-temperature": next_water_temperature,
    "ph": next_ph,
    "salinity": next_salinity,
    "turbidity": next_turbidity,
    "ammonia-nh3-total": next_ammonia_nh3_total,
    "nitrite-no2": next_nitrite_no2,
    "orp": next_orp,
    "water-level": next_water_level,
    "feeder-load-cell": next_feeder_load_cell,
}
