"""Decimal-safe JSON conversion for DynamoDB items, both directions."""
import json
from decimal import Decimal
from typing import Any


class DecimalEncoder(json.JSONEncoder):
    """json.dumps default= helper: DynamoDB returns Decimal, JSON has no such type."""

    def default(self, obj: Any) -> Any:
        if isinstance(obj, Decimal):
            # Whole-valued Decimals (e.g. rpm counts) stay ints; the rest keep their fraction.
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


def to_decimal(value: Any) -> Any:
    """Recursively convert floats to Decimal before a put_item (DynamoDB rejects float)."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_decimal(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_decimal(v) for v in value]
    return value


def dumps(payload: Any) -> str:
    return json.dumps(payload, cls=DecimalEncoder)
