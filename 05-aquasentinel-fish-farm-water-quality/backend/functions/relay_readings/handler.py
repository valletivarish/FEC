"""API Gateway HTTP API handler for POST /readings — relays the fog dispatcher's raw body onto the readings queue."""
import os
from typing import Any

import boto3

READINGS_QUEUE_URL = os.environ["AQUASENTINEL_READINGS_QUEUE_URL"]

sqs = boto3.client("sqs")


def _response(status: int, body: str) -> dict[str, Any]:
    return {"statusCode": status, "body": body}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    # Body is forwarded as-is; ingest_readings already parses and validates it downstream.
    body = event.get("body") or ""
    try:
        sqs.send_message(QueueUrl=READINGS_QUEUE_URL, MessageBody=body)
        return _response(202, "")
    except Exception as exc:
        print(f"relay_readings failed: {exc}")
        return _response(500, "")
