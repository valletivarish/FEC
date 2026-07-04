import json
from decimal import Decimal

import boto3
from moto import mock_aws

from conftest import import_handler

TABLE_NAME = "GreenGridReadings"


def _create_table(region: str) -> None:
    client = boto3.client("dynamodb", region_name=region)
    client.create_table(
        TableName=TABLE_NAME,
        KeySchema=[
            {"AttributeName": "station_id", "KeyType": "HASH"},
            {"AttributeName": "event_type_timestamp", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "station_id", "AttributeType": "S"},
            {"AttributeName": "event_type_timestamp", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )


def _seed(table, station_id: str, event_type: str, timestamp: str, **extra):
    item = {
        "station_id": station_id,
        "event_type_timestamp": f"{event_type}#{timestamp}",
        "type": event_type,
        "timestamp": timestamp,
    }
    item.update(extra)
    table.put_item(Item=item)


def _api_event(station_id: str, query_params: dict | None = None) -> dict:
    return {
        "pathParameters": {"station_id": station_id},
        "queryStringParameters": query_params,
    }


def test_returns_200_with_decimal_encoded_numbers():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("query_handler")
        table = handler_module.dynamodb.Table(TABLE_NAME)

        _seed(
            table,
            "station-quad",
            "weather_event",
            "2026-07-02T09:00:00Z",
            storm_risk_score=Decimal("82.5"),
            mean_wind_speed=Decimal("12.3"),
        )
        _seed(
            table,
            "station-quad",
            "pollution_event",
            "2026-07-02T09:10:00Z",
            rolling_p95=Decimal("45.6"),
            exceedance_count=Decimal("6"),
        )

        response = handler_module.handler(_api_event("station-quad"), None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["station_id"] == "station-quad"
        assert len(body["events"]) == 2

        by_type = {item["type"]: item for item in body["events"]}
        assert by_type["weather_event"]["storm_risk_score"] == 82.5
        assert isinstance(by_type["weather_event"]["storm_risk_score"], float)
        assert by_type["pollution_event"]["exceedance_count"] == 6
        assert isinstance(by_type["pollution_event"]["exceedance_count"], int)


def test_results_are_most_recent_first():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("query_handler")
        table = handler_module.dynamodb.Table(TABLE_NAME)

        _seed(table, "station-arboretum", "soil_event", "2026-07-02T09:00:00Z", risk="irrigation_need")
        _seed(table, "station-arboretum", "soil_event", "2026-07-02T10:00:00Z", risk="frost_risk")

        response = handler_module.handler(_api_event("station-arboretum"), None)
        body = json.loads(response["body"])

        assert body["events"][0]["risk"] == "frost_risk"
        assert body["events"][1]["risk"] == "irrigation_need"


def test_missing_station_id_returns_400():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("query_handler")

        response = handler_module.handler({"pathParameters": {}}, None)
        assert response["statusCode"] == 400


def test_unknown_station_returns_empty_events_list():
    with mock_aws():
        _create_table("eu-west-1")
        handler_module = import_handler("query_handler")

        response = handler_module.handler(_api_event("station-nowhere"), None)
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["events"] == []
