"""Shared DynamoDB resource and item-conversion helpers used by all Lambda handlers."""
from decimal import Decimal
from typing import Any

import boto3

# No endpoint override here: boto3 reads AWS_ENDPOINT_URL from the environment,
# so local dev (LocalStack etc.) and real AWS deployment share this exact line.
dynamodb = boto3.resource("dynamodb")


def to_dynamo_item(item: dict[str, Any]) -> dict[str, Any]:
    """Recursively convert floats to Decimal since DynamoDB rejects native floats."""
    if isinstance(item, float):
        return Decimal(str(item))
    if isinstance(item, dict):
        return {key: to_dynamo_item(value) for key, value in item.items()}
    if isinstance(item, list):
        return [to_dynamo_item(value) for value in item]
    return item


def from_dynamo_item(item: dict[str, Any]) -> dict[str, Any]:
    """Recursively convert Decimal back to float for JSON responses."""
    if isinstance(item, Decimal):
        return float(item)
    if isinstance(item, dict):
        return {key: from_dynamo_item(value) for key, value in item.items()}
    if isinstance(item, list):
        return [from_dynamo_item(value) for value in item]
    return item
