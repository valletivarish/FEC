"""Canonical advisory dict shape shared by intake, ingest and query handlers.

Kept as a single small module duplicated into each Lambda asset folder
(no Lambda layer) since the shape is tiny and stability matters more
than DRY here.
"""
from typing import Any

VALID_ADVISORY_TYPES = {
    "band_change",
    "spike",
    "rate_of_rise",
    "limit_exceeded",
    "comfort_alert",
    "setpoint_recommendation",
    "zone_cleared",
}

REQUIRED_FIELDS = ("zone_id", "sensor", "advisory_type", "timestamp")


def validate_advisory(advisory: dict[str, Any]) -> list[str]:
    """Return a list of validation error strings; empty list means valid."""
    errors = []
    for field in REQUIRED_FIELDS:
        if field not in advisory or advisory[field] in (None, ""):
            errors.append(f"missing required field: {field}")
    advisory_type = advisory.get("advisory_type")
    if advisory_type is not None and advisory_type not in VALID_ADVISORY_TYPES:
        errors.append(f"unknown advisory_type: {advisory_type}")
    return errors


def event_timestamp_sensor_key(timestamp: str, sensor: str) -> str:
    """Build the DynamoDB sort key: isoTimestamp#sensor, per shared contract."""
    return f"{timestamp}#{sensor}"
