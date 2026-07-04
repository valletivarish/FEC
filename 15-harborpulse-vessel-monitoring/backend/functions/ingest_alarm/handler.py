import json
import logging
import os
import time

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.client("dynamodb")

THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60


def _to_item(body: dict) -> dict:
    item = {
        "vesselId": {"S": body["vesselId"]},
        "timestamp": {"S": body["timestamp"]},
        "payload": {"S": json.dumps(body)},
    }
    # only a resolved alarm should age out; an active one must persist indefinitely
    if body.get("alarmActive") is False:
        item["ttlEpochSeconds"] = {"N": str(int(time.time()) + THIRTY_DAYS_SECONDS)}
    return item


def handler(event, context):
    table_name = os.environ["HARBORPULSE_ALARMS_TABLE"]

    for record in event.get("Records", []):
        try:
            body = json.loads(record["body"])
            item = _to_item(body)
            dynamodb.put_item(TableName=table_name, Item=item)
        except Exception:
            # one bad record must not sink the rest of the batch
            logger.exception("failed to ingest alarm record: %s", record.get("body"))

    return {"statusCode": 200}
