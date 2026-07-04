"""API Gateway HTTP API handler for GET /assets/{asset_id}/diagnoses."""
import os
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from shared.json_encoder import dumps

dynamodb = boto3.resource("dynamodb")

DEFAULT_LIMIT = 50


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    path_params = event.get("pathParameters") or {}
    asset_id = path_params.get("asset_id")

    if not asset_id:
        return {"statusCode": 400, "body": dumps({"error": "asset_id is required"})}

    table = dynamodb.Table(os.environ["GUARD_DIAGNOSIS_TABLE"])

    # Sort key is prefixed by event type, so a plain KeyConditionExpression on the partition
    # key alone returns recent diagnoses of every type for the asset, newest scan pass last.
    response = table.query(
        KeyConditionExpression=Key("asset_id").eq(asset_id),
        ScanIndexForward=False,
        Limit=DEFAULT_LIMIT,
    )

    return {
        "statusCode": 200,
        "body": dumps({"asset_id": asset_id, "diagnoses": response.get("Items", [])}),
    }
