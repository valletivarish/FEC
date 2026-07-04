"""Band classification for sensors whose dispatch_rate can be on_change.

Bands are coarse severity buckets; a reading only re-dispatches when it
crosses from one bucket into another, not on every small fluctuation.
"""
from __future__ import annotations

# Upper bound (inclusive) per band, in ascending order; last band has no cap.
_BAND_THRESHOLDS: dict[str, list[tuple[str, float]]] = {
    "co2": [
        ("good", 800.0),
        ("moderate", 1000.0),
        ("poor", 1500.0),
        ("very_poor", 2500.0),
        ("hazardous", float("inf")),
    ],
    "pm25": [
        ("good", 12.0),
        ("moderate", 35.0),
        ("poor", 55.0),
        ("hazardous", float("inf")),
    ],
    "pm10": [
        ("good", 54.0),
        ("moderate", 154.0),
        ("poor", 254.0),
        ("hazardous", float("inf")),
    ],
    "tvoc": [
        ("good", 220.0),
        ("moderate", 660.0),
        ("poor", 1430.0),
        ("hazardous", float("inf")),
    ],
    "co": [
        ("good", 4.4),
        ("moderate", 9.4),
        ("poor", 15.4),
        ("hazardous", float("inf")),
    ],
    "no2": [
        ("good", 53.0),
        ("moderate", 100.0),
        ("poor", 360.0),
        ("hazardous", float("inf")),
    ],
    "hcho": [
        ("good", 30.0),
        ("moderate", 100.0),
        ("poor", 300.0),
        ("hazardous", float("inf")),
    ],
}

BANDED_SENSORS = frozenset(_BAND_THRESHOLDS.keys())


def classify_band(sensor: str, value: float) -> str:
    """Map a reading to its severity band name for the given sensor."""
    thresholds = _BAND_THRESHOLDS.get(sensor)
    if thresholds is None:
        raise ValueError(f"no band thresholds configured for sensor '{sensor}'")
    for band_name, upper_bound in thresholds:
        if value <= upper_bound:
            return band_name
    return thresholds[-1][0]
