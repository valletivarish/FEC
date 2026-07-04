import json
import logging
import os
from decimal import Decimal

from shared.ddb import dynamodb

logger = logging.getLogger()
logger.setLevel(logging.INFO)

VALID_EVENT_TYPES = {"weather_event", "soil_event", "pollution_event", "node_health"}
COUNTER_STATION_ID = "__meta__"
COUNTER_SORT_KEY = "counters#totals"


def _floats_to_decimal(value):
    # DynamoDB rejects native float; incoming event JSON always carries floats
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: _floats_to_decimal(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_floats_to_decimal(val) for val in value]
    return value


def _to_item(body: dict) -> dict:
    event_type = body["type"]
    if event_type not in VALID_EVENT_TYPES:
        raise ValueError(f"unknown event type: {event_type}")
    item = _floats_to_decimal(dict(body))
    item["event_type_timestamp"] = f'{event_type}#{body["timestamp"]}'
    return item


def _bump_received_counter(table, amount: int) -> None:
    # a single running counter row backs the backend-status "messages received" figure;
    # ADD is atomic so concurrent Lambda invocations never clobber each other's count
    if amount <= 0:
        return
    table.update_item(
        Key={"station_id": COUNTER_STATION_ID, "event_type_timestamp": COUNTER_SORT_KEY},
        UpdateExpression="ADD messages_received :n",
        ExpressionAttributeValues={":n": amount},
    )


def handler(event, context):
    table = dynamodb.Table(os.environ["GREENGRID_READINGS_TABLE"])
    processed = 0
    failed = 0

    for record in event.get("Records", []):
        try:
            body = json.loads(record["body"])
            item = _to_item(body)
            table.put_item(Item=item)
            processed += 1
        except Exception:
            # one bad record must never sink the rest of the batch
            failed += 1
            logger.exception("failed to process record: %s", record.get("body"))

    _bump_received_counter(table, processed)

    logger.info("ingest complete: processed=%d failed=%d", processed, failed)
    return {"processed": processed, "failed": failed}
