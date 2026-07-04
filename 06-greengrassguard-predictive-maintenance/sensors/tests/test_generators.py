"""Every generator must stay within its contract range across many iterations,
and the vibe generators' window field must be a real, plausible waveform."""
import math

import pytest

from sensors.generators import (
    GENERATORS,
    VIBE_WINDOW_SIZE,
    _RANGES,
    next_vibe_axial,
    next_vibe_radial,
    vibe_window,
)

N_ITERATIONS = 2000


@pytest.mark.parametrize("metric", list(GENERATORS.keys()))
def test_generator_stays_within_bounds(metric):
    lo, hi = _RANGES[metric]
    fn = GENERATORS[metric]
    value = None
    for _ in range(N_ITERATIONS):
        value = fn(value)
        assert lo <= value <= hi, f"{metric} produced {value} outside [{lo}, {hi}]"


@pytest.mark.parametrize("metric", list(GENERATORS.keys()))
def test_generator_first_call_seeds_within_bounds(metric):
    lo, hi = _RANGES[metric]
    fn = GENERATORS[metric]
    value = fn(None)
    assert lo <= value <= hi


@pytest.mark.parametrize("fn", [next_vibe_axial, next_vibe_radial])
def test_vibe_generator_produces_varying_values(fn):
    value = None
    seen = set()
    for _ in range(200):
        value = fn(value)
        seen.add(round(value, 6))
    assert len(seen) > 1


@pytest.mark.parametrize("metric", ["vibe-axial", "vibe-radial"])
def test_vibe_window_length(metric):
    window = vibe_window(5.0, metric)
    assert len(window) == VIBE_WINDOW_SIZE


@pytest.mark.parametrize("metric", ["vibe-axial", "vibe-radial"])
def test_vibe_window_all_finite_numbers(metric):
    window = vibe_window(3.0, metric)
    for sample in window:
        assert isinstance(sample, float)
        assert math.isfinite(sample)


@pytest.mark.parametrize("metric", ["vibe-axial", "vibe-radial"])
def test_vibe_window_amplitude_scales_with_value(metric):
    lo, hi = _RANGES[metric]
    small_window = vibe_window(lo, metric)
    large_window = vibe_window(hi, metric)
    small_peak = max(abs(s) for s in small_window)
    large_peak = max(abs(s) for s in large_window)
    assert large_peak > small_peak


def test_vibe_window_zero_value_is_near_silent():
    window = vibe_window(0.0, "vibe-axial")
    # amplitude scaling means a zero reading should produce a (near) flat window
    assert max(abs(s) for s in window) < 1e-6
