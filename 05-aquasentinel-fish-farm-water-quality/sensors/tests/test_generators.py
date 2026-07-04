"""Every generator must stay within its documented physical range across many steps."""

from sensors.generators import (
    next_ammonia_nh3_total,
    next_dissolved_oxygen,
    next_feeder_load_cell,
    next_nitrite_no2,
    next_orp,
    next_ph,
    next_salinity,
    next_turbidity,
    next_water_level,
    next_water_temperature,
)

ITERATIONS = 5000

CASES = [
    (next_dissolved_oxygen, 0.5, 12.0),
    (next_water_temperature, 10.0, 34.0),
    (next_ph, 5.5, 9.5),
    (next_salinity, 0.0, 35.0),
    (next_turbidity, 0.0, 400.0),
    (next_ammonia_nh3_total, 0.0, 8.0),
    (next_nitrite_no2, 0.0, 5.0),
    (next_orp, -50.0, 450.0),
    (next_water_level, 0.0, 250.0),
    (next_feeder_load_cell, 0.0, 5000.0),
]


def test_generators_stay_within_bounds():
    for generator, low, high in CASES:
        value = None
        for _ in range(ITERATIONS):
            value = generator(value)
            assert low <= value <= high, f"{generator.__name__} produced {value} outside [{low}, {high}]"


def test_generators_cold_start_returns_a_value():
    for generator, low, high in CASES:
        value = generator(None)
        assert low <= value <= high


def test_generators_are_stochastic_not_constant():
    # a real random walk should not freeze at a single value over many steps
    for generator, _low, _high in CASES:
        value = None
        seen = set()
        for _ in range(200):
            value = generator(value)
            seen.add(round(value, 6))
        assert len(seen) > 1, f"{generator.__name__} never changed value"
