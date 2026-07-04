"""Local-only stand-in for the API Gateway HTTP API edge that floci's community edition
does not implement as a data-plane (control-plane create/deploy succeeds, but no execute-api
path actually routes -- see 03-aerosense-air-quality/load/load_test.py for the same finding).
Forwards real HTTP requests to the real deployed Lambdas via boto3 invoke, so every line of
backend code executes unchanged; only the edge routing floci is missing gets emulated here.
Real AWS deployment never uses this file -- API Gateway does the routing there. Stdlib-only
so it needs no addition to any requirements.txt.
"""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import boto3

ENDPOINT = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")
REGION = os.environ.get("AWS_REGION", "eu-west-1")

lambda_client = boto3.client(
    "lambda",
    endpoint_url=ENDPOINT,
    region_name=REGION,
    aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "test"),
    aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
)

STATION_EVENTS_RE = re.compile(r"^/stations/([^/]+)/events$")


def _invoke(function_name: str, event: dict):
    resp = lambda_client.invoke(
        FunctionName=function_name,
        InvocationType="RequestResponse",
        Payload=json.dumps(event).encode(),
    )
    payload = json.loads(resp["Payload"].read())
    status = payload.get("statusCode", 200)
    raw_body = payload.get("body")
    body = raw_body if raw_body is not None else json.dumps(payload)
    return status, body


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: str):
        encoded = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_POST(self):
        if self.path == "/events":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length).decode() if length else ""
            event = {"body": raw}
            status, body = _invoke("greengrid-relay-events-fn", event)
            self._send(status, body)
        else:
            self._send(404, json.dumps({"message": "not found"}))

    def do_GET(self):
        parsed = urlparse(self.path)
        match = STATION_EVENTS_RE.match(parsed.path)
        if match:
            station_id = match.group(1)
            query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            event = {
                "pathParameters": {"station_id": station_id},
                "queryStringParameters": query or None,
            }
            status, body = _invoke("greengrid-query-handler-fn", event)
            self._send(status, body)
        elif parsed.path == "/status":
            status, body = _invoke("greengrid-status-handler-fn", {})
            self._send(status, body)
        else:
            self._send(404, json.dumps({"message": "not found"}))

    def log_message(self, fmt, *args):
        print(f"[shim] {self.address_string()} {fmt % args}")


if __name__ == "__main__":
    port = int(os.environ.get("GREENGRID_SHIM_PORT", "3701"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"local_dev_shim listening on :{port}, forwarding to real Lambdas via", ENDPOINT)
    server.serve_forever()
