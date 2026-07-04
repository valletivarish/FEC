"""Atomic running counters for the dashboard's operations-console metrics.

A single DynamoDB item per counter name, incremented with ADD so concurrent Lambda
invocations never lose an update the way a read-modify-write would.
"""
import boto3

COUNTERS_TABLE = "AquaSentinelSystemCounters"

READINGS_RECEIVED = "readings_received_total"
ALERTS_RECEIVED = "alerts_received_total"
READINGS_STORED = "readings_stored_total"
ALERTS_STORED = "alerts_stored_total"


def increment(table_name: str, counter_name: str, by: int = 1) -> None:
    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(table_name)
    table.update_item(
        Key={"counter_name": counter_name},
        UpdateExpression="ADD #v :by",
        ExpressionAttributeNames={"#v": "value"},
        ExpressionAttributeValues={":by": by},
    )


def read_all(table_name: str) -> dict[str, int]:
    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(table_name)
    result = table.scan()
    return {item["counter_name"]: int(item["value"]) for item in result.get("Items", [])}
