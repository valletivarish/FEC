import json
import os
from typing import Any

import boto3

from shared.advisory_shape import validate_advisory

_sqs = boto3.client("sqs")
_QUEUE_URL = os.environ["AEROSENSE_ADVISORY_QUEUE_URL"]

_HEADERS = {"Content-Type": "application/json"}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """HTTP API proxy target for POST /advisories: validate, then hand off to SQS.

    Stands in for a direct HTTP-API-to-SQS integration (see aerosense_stack.py).
    """
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "invalid JSON body"})

    errors = validate_advisory(body)
    if errors:
        return _response(400, {"error": "validation failed", "details": errors})

    _sqs.send_message(QueueUrl=_QUEUE_URL, MessageBody=json.dumps(body))
    return _response(202, {"status": "accepted"})


def _response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": _HEADERS,
        "body": json.dumps(payload),
    }
