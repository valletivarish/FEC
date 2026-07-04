import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.client("dynamodb")


def _to_item(body: dict) -> dict:
    # sort key composition keeps events of the same type ordered by time under one vessel
    sort_key = f"{body['type']}#{body['timestamp']}"
    return {
        "vesselId": {"S": body["vesselId"]},
        "metricTypeTimestamp": {"S": sort_key},
        "payload": {"S": json.dumps(body)},
    }


def handler(event, context):
    table_name = os.environ["HARBORPULSE_TELEMETRY_TABLE"]

    for record in event.get("Records", []):
        try:
            body = json.loads(record["body"])
            item = _to_item(body)
            dynamodb.put_item(TableName=table_name, Item=item)
        except Exception:
            # one bad record must not sink the rest of the batch
            logger.exception("failed to ingest telemetry record: %s", record.get("body"))

    return {"statusCode": 200}
