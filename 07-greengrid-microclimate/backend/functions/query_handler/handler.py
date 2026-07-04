import os

from boto3.dynamodb.conditions import Key

from shared.ddb import dynamodb
from shared.json_encoder import dumps

DEFAULT_LIMIT = 50


def handler(event, context):
    path_params = event.get("pathParameters") or {}
    station_id = path_params.get("station_id")

    if not station_id:
        return {"statusCode": 400, "body": dumps({"message": "station_id is required"})}

    query_params = event.get("queryStringParameters") or {}
    limit = int(query_params.get("limit", DEFAULT_LIMIT))

    table = dynamodb.Table(os.environ["GREENGRID_READINGS_TABLE"])
    response = table.query(
        KeyConditionExpression=Key("station_id").eq(station_id),
        ScanIndexForward=False,
        Limit=limit,
    )

    return {
        "statusCode": 200,
        "body": dumps({"station_id": station_id, "events": response.get("Items", [])}),
    }
