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

# Handlers read table/queue names from env at import time, so these must exist before any import_handler call.
os.environ.setdefault("AQUASENTINEL_READINGS_TABLE", "AquaSentinelPondReadings")
os.environ.setdefault("AQUASENTINEL_ALERTS_TABLE", "AquaSentinelPondAlerts")
os.environ.setdefault("AQUASENTINEL_COUNTERS_TABLE", "AquaSentinelSystemCounters")
os.environ.setdefault(
    "AQUASENTINEL_READINGS_QUEUE_URL", "https://sqs.eu-west-1.amazonaws.com/000000000000/aquasentinel-readings-queue"
)
os.environ.setdefault(
    "AQUASENTINEL_ALERTS_QUEUE_URL", "https://sqs.eu-west-1.amazonaws.com/000000000000/aquasentinel-alerts-queue"
)


def create_counters_table(region: str) -> None:
    """Every ingest handler now writes running counters, so tests exercising a real put/update need this table too."""
    import boto3

    client = boto3.client("dynamodb", region_name=region)
    client.create_table(
        TableName="AquaSentinelSystemCounters",
        KeySchema=[{"AttributeName": "counter_name", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "counter_name", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )


def import_handler(function_name: str):
    """Every Lambda folder has its own handler.py, so isolate sys.path per import to avoid collisions."""
    import importlib

    sys.modules.pop("handler", None)

    function_dir = os.path.join(FUNCTIONS_ROOT, function_name)
    sys.path = [p for p in sys.path if not p.startswith(FUNCTIONS_ROOT)]
    sys.path.insert(0, function_dir)

    return importlib.import_module("handler")
