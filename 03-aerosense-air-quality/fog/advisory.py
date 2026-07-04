"""Advisory shape and pollutant band classification shared by all fog nodes."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

BAND_ORDER = [
    "good",
    "moderate",
    "unhealthy_sensitive",
    "unhealthy",
    "very_unhealthy",
    "hazardous",
]

# Upper bound (inclusive) of each band per pollutant, simplified from EPA AQI
# breakpoints and rescaled to the raw sensor units used on the wire.
_BREAKPOINTS: dict[str, list[tuple[float, str]]] = {
    "pm25": [
        (12.0, "good"),
        (35.4, "moderate"),
        (55.4, "unhealthy_sensitive"),
        (150.4, "unhealthy"),
        (250.4, "very_unhealthy"),
        (float("inf"), "hazardous"),
    ],
    "pm10": [
        (54.0, "good"),
        (154.0, "moderate"),
        (254.0, "unhealthy_sensitive"),
        (354.0, "unhealthy"),
        (424.0, "very_unhealthy"),
        (float("inf"), "hazardous"),
    ],
    "tvoc": [
        (220.0, "good"),
        (660.0, "moderate"),
        (1000.0, "unhealthy_sensitive"),
        (1500.0, "unhealthy"),
        (2000.0, "very_unhealthy"),
        (float("inf"), "hazardous"),
    ],
    "hcho": [
        (30.0, "good"),
        (80.0, "moderate"),
        (120.0, "unhealthy_sensitive"),
        (250.0, "unhealthy"),
        (400.0, "very_unhealthy"),
        (float("inf"), "hazardous"),
    ],
}


def classify_band(sensor: str, value: float) -> str:
    """Map a raw pollutant reading to its EPA-style band for the given sensor."""
    table = _BREAKPOINTS.get(sensor)
    if table is None:
        raise ValueError(f"no breakpoint table for sensor '{sensor}'")
    for upper, band in table:
        if value <= upper:
            return band
    return "hazardous"


def band_upper_edge(sensor: str, band: str) -> float:
    """Return the upper numeric edge of a band, used for spike detection."""
    table = _BREAKPOINTS.get(sensor)
    if table is None:
        raise ValueError(f"no breakpoint table for sensor '{sensor}'")
    for upper, name in table:
        if name == band:
            return upper
    raise ValueError(f"unknown band '{band}' for sensor '{sensor}'")


@dataclass
class Advisory:
    """Fog event dispatched to the backend ingest API, matching the shared contract."""

    zone_id: str
    sensor: str
    advisory_type: str
    timestamp: str
    band: Optional[str] = None
    value: Optional[float] = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize in the exact key order/shape the ingest API expects."""
        return {
            "zone_id": self.zone_id,
            "sensor": self.sensor,
            "advisory_type": self.advisory_type,
            "band": self.band,
            "value": self.value,
            "details": self.details,
            "timestamp": self.timestamp,
        }
