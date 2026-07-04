"""Decimal-safe JSON helpers shared by handlers that read from DynamoDB."""
import json
from decimal import Decimal
from typing import Any


class DecimalEncoder(json.JSONEncoder):
    """DynamoDB returns numbers as Decimal; API responses need plain int/float."""

    def default(self, o: Any) -> Any:
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


def to_decimal(value: Any) -> Any:
    """Floats aren't accepted by DynamoDB's Item API, so convert recursively before a put_item."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_decimal(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_decimal(v) for v in value]
    return value


def dumps(payload: Any) -> str:
    return json.dumps(payload, cls=DecimalEncoder)
