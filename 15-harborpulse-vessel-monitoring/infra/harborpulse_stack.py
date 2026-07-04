from aws_cdk import (
    Stack,
    Duration,
    aws_sqs as sqs,
    aws_lambda as lambda_,
    aws_lambda_event_sources as lambda_event_sources,
    aws_dynamodb as dynamodb,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as apigwv2_integrations,
)
from constructs import Construct


class HarborPulseStack(Stack):
    """Fleet telemetry/alarm ingest queues + tables, and the HTTP API that lets the
    fog dispatcher's POSTs actually reach the SQS-backed ingest pipeline."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        telemetry_dlq = sqs.Queue(
            self,
            "TelemetryDlq",
            queue_name="harborpulse-telemetry-dlq",
        )
        telemetry_queue = sqs.Queue(
            self,
            "TelemetryQueue",
            queue_name="harborpulse-telemetry-queue",
            visibility_timeout=Duration.seconds(30),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=5,
                queue=telemetry_dlq,
            ),
        )

        alarm_dlq = sqs.Queue(
            self,
            "AlarmDlq",
            queue_name="harborpulse-alarm-dlq",
        )
        alarm_queue = sqs.Queue(
            self,
            "AlarmQueue",
            queue_name="harborpulse-alarm-queue",
            visibility_timeout=Duration.seconds(30),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=5,
                queue=alarm_dlq,
            ),
        )

        telemetry_table = dynamodb.Table(
            self,
            "TelemetryTable",
            table_name="harborpulse-telemetry-table",
            partition_key=dynamodb.Attribute(
                name="vesselId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="metricTypeTimestamp", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        # TTL lets resolved bilge alarms age out after ~30 days while active ones
        # (no ttlEpochSeconds attribute set) are retained indefinitely.
        alarms_table = dynamodb.Table(
            self,
            "AlarmsTable",
            table_name="harborpulse-alarms-table",
            partition_key=dynamodb.Attribute(
                name="vesselId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="timestamp", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="ttlEpochSeconds",
        )

        # Capped at 20 concurrent executions so a telemetry flood can't starve the
        # rest of the account's Lambda concurrency pool shared with the alarm path.
        ingest_telemetry_fn = lambda_.Function(
            self,
            "IngestTelemetryFn",
            function_name="harborpulse-ingest-telemetry-fn",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset("../backend/functions/ingest_telemetry"),
            timeout=Duration.seconds(30),
            reserved_concurrent_executions=20,
            environment={
                "HARBORPULSE_TELEMETRY_TABLE": telemetry_table.table_name,
            },
        )
        telemetry_table.grant_write_data(ingest_telemetry_fn)
        ingest_telemetry_fn.add_event_source(
            lambda_event_sources.SqsEventSource(telemetry_queue, batch_size=10)
        )

        ingest_alarm_fn = lambda_.Function(
            self,
            "IngestAlarmFn",
            function_name="harborpulse-ingest-alarm-fn",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset("../backend/functions/ingest_alarm"),
            timeout=Duration.seconds(30),
            environment={
                "HARBORPULSE_ALARMS_TABLE": alarms_table.table_name,
            },
        )
        alarms_table.grant_write_data(ingest_alarm_fn)
        ingest_alarm_fn.add_event_source(
            lambda_event_sources.SqsEventSource(alarm_queue, batch_size=10)
        )

        query_fleet_fn = lambda_.Function(
            self,
            "QueryFleetFn",
            function_name="harborpulse-query-fleet-fn",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset("../backend/functions/query_fleet"),
            timeout=Duration.seconds(10),
            environment={
                "HARBORPULSE_TELEMETRY_TABLE": telemetry_table.table_name,
                "HARBORPULSE_ALARMS_TABLE": alarms_table.table_name,
            },
        )
        telemetry_table.grant_read_data(query_fleet_fn)
        alarms_table.grant_read_data(query_fleet_fn)

        # Two separate deployments of the same relay shape, each scoped to send
        # only to its own queue — this is the piece missing from earlier sibling
        # projects, where the fog dispatcher's HTTP POST had no route to land on.
        relay_telemetry_fn = lambda_.Function(
            self,
            "RelayTelemetryFn",
            function_name="harborpulse-relay-telemetry-fn",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset("../backend/functions/relay_telemetry"),
            timeout=Duration.seconds(10),
            environment={
                "HARBORPULSE_TARGET_QUEUE_URL": telemetry_queue.queue_url,
            },
        )
        telemetry_queue.grant_send_messages(relay_telemetry_fn)

        relay_alarm_fn = lambda_.Function(
            self,
            "RelayAlarmFn",
            function_name="harborpulse-relay-alarm-fn",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset("../backend/functions/relay_alarm"),
            timeout=Duration.seconds(10),
            environment={
                "HARBORPULSE_TARGET_QUEUE_URL": alarm_queue.queue_url,
            },
        )
        alarm_queue.grant_send_messages(relay_alarm_fn)

        http_api = apigwv2.HttpApi(
            self,
            "HarborPulseHttpApi",
            api_name="harborpulse-api",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
                allow_headers=["*"],
            ),
        )

        query_integration = apigwv2_integrations.HttpLambdaIntegration(
            "QueryFleetIntegration", query_fleet_fn
        )
        relay_telemetry_integration = apigwv2_integrations.HttpLambdaIntegration(
            "RelayTelemetryIntegration", relay_telemetry_fn
        )
        relay_alarm_integration = apigwv2_integrations.HttpLambdaIntegration(
            "RelayAlarmIntegration", relay_alarm_fn
        )

        http_api.add_routes(
            path="/fleet/summary",
            methods=[apigwv2.HttpMethod.GET],
            integration=query_integration,
        )
        http_api.add_routes(
            path="/vessels/{vesselId}/telemetry",
            methods=[apigwv2.HttpMethod.GET],
            integration=query_integration,
        )
        http_api.add_routes(
            path="/telemetry",
            methods=[apigwv2.HttpMethod.POST],
            integration=relay_telemetry_integration,
        )
        http_api.add_routes(
            path="/alarms",
            methods=[apigwv2.HttpMethod.POST],
            integration=relay_alarm_integration,
        )

        self.http_api = http_api
        self.telemetry_queue = telemetry_queue
        self.alarm_queue = alarm_queue
        self.telemetry_table = telemetry_table
        self.alarms_table = alarms_table
