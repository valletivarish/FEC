"""API Gateway HTTP API handler for POST /diagnoses: relays the raw body onto the
fault-intake queue unparsed, since intake_handler already owns validation and shaping."""
import os
from typing import Any

import boto3

from shared.json_encoder import dumps
from shared.ops_counters import RECEIVED, increment

sqs = boto3.client("sqs")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    body = event.get("body") or ""

    if not body:
        return {"statusCode": 400, "body": dumps({"error": "request body is required"})}

    sqs.send_message(
        QueueUrl=os.environ["GUARD_INTAKE_QUEUE_URL"],
        MessageBody=body,
    )
    # counted at the relay boundary, the first point the backend actually saw the fog node's POST
    increment(RECEIVED)

    return {"statusCode": 202, "body": dumps({"status": "accepted"})}
