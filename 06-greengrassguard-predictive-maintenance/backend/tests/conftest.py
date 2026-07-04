"""Shared pytest bootstrap: fake AWS creds plus a helper to import a single handler in isolation."""
import os
import sys

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNCTIONS_ROOT = os.path.join(BACKEND_ROOT, "functions")

if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

# Tests never touch real AWS, so fake credentials keep boto3/moto happy offline.
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ.setdefault("AWS_DEFAULT_REGION", "eu-west-1")

os.environ.setdefault("GUARD_DIAGNOSIS_TABLE", "GuardDiagnosisEvents")

TABLE_NAME = os.environ["GUARD_DIAGNOSIS_TABLE"]


def import_handler(function_name: str):
    """Every Lambda folder has its own handler.py, so isolate sys.path per import to avoid collisions."""
    import importlib

    sys.modules.pop("handler", None)

    function_dir = os.path.join(FUNCTIONS_ROOT, function_name)
    sys.path = [p for p in sys.path if not p.startswith(FUNCTIONS_ROOT)]
    sys.path.insert(0, function_dir)

    return importlib.import_module("handler")


def create_diagnosis_table(region: str = "eu-west-1"):
    import boto3

    client = boto3.client("dynamodb", region_name=region)
    client.create_table(
        TableName=TABLE_NAME,
        KeySchema=[
            {"AttributeName": "asset_id", "KeyType": "HASH"},
            {"AttributeName": "event_type_timestamp", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "asset_id", "AttributeType": "S"},
            {"AttributeName": "event_type_timestamp", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
