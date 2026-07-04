from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    aws_sqs as sqs,
    aws_lambda as lambda_,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as apigwv2_integrations,
    aws_lambda_event_sources as lambda_event_sources,
    aws_dynamodb as dynamodb,
)
from constructs import Construct


class GreenGridStack(Stack):
    """Single-stack deployment: ingest queue, readings table, HTTP API and Lambdas."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        dlq = sqs.Queue(
            self,
            "GreenGridIngestDlq",
            queue_name="greengrid-ingest-dlq",
            retention_period=Duration.days(14),
        )

        ingest_queue = sqs.Queue(
            self,
            "GreenGridIngestQueue",
            queue_name="greengrid-ingest-queue",
            visibility_timeout=Duration.seconds(30),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=5,
                queue=dlq,
            ),
        )

        readings_table = dynamodb.Table(
            self,
            "GreenGridReadings",
            table_name="GreenGridReadings",
            partition_key=dynamodb.Attribute(
                name="station_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="event_type_timestamp", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Lets the dashboard query one event type (e.g. weather_event) across all stations
        # without a full table scan, separate from the per-station access pattern above.
        readings_table.add_global_secondary_index(
            index_name="SensorTypeIndex",
            partition_key=dynamodb.Attribute(
                name="type", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="event_type_timestamp", type=dynamodb.AttributeType.STRING
            ),
        )

        common_env = {
            "GREENGRID_READINGS_TABLE": readings_table.table_name,
        }

        # Whole backend/ directory ships as one asset so shared/ resolves as a sibling
        # package under the dotted handler paths below.
        backend_asset = lambda_.Code.from_asset("../backend")

        ingest_fn = lambda_.Function(
            self,
            "IngestHandlerFn",
            function_name="greengrid-ingest-handler-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.ingest_handler.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(30),
            environment=common_env,
            # Caps concurrent pollers on the ingest queue so a station-heartbeat burst
            # load-levels through SQS instead of firing unbounded Lambda invocations.
            reserved_concurrent_executions=20,
        )
        readings_table.grant_write_data(ingest_fn)
        ingest_fn.add_event_source(
            lambda_event_sources.SqsEventSource(
                ingest_queue,
                batch_size=10,
            )
        )

        query_fn = lambda_.Function(
            self,
            "QueryHandlerFn",
            function_name="greengrid-query-handler-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.query_handler.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment=common_env,
        )
        readings_table.grant_read_data(query_fn)

        # Bridges the fog dispatcher's HTTP POST to the SQS-backed ingest pipeline;
        # relays the raw body only, all parsing/validation still happens in ingest_fn.
        relay_fn = lambda_.Function(
            self,
            "RelayEventsFn",
            function_name="greengrid-relay-events-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.relay_events.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment={
                "GREENGRID_TARGET_QUEUE_URL": ingest_queue.queue_url,
            },
        )
        ingest_queue.grant_send_messages(relay_fn)

        # Backs the dashboard's Backend Status page: real DescribeTable + GetQueueAttributes
        # checks plus the running message counters, no hardcoded status strings.
        status_fn = lambda_.Function(
            self,
            "StatusHandlerFn",
            function_name="greengrid-status-handler-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.status_handler.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment={
                **common_env,
                "GREENGRID_TARGET_QUEUE_URL": ingest_queue.queue_url,
            },
        )
        readings_table.grant_read_data(status_fn)
        ingest_queue.grant_consume_messages(status_fn)

        http_api = apigwv2.HttpApi(
            self,
            "GreenGridHttpApi",
            api_name="greengrid-api",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
                allow_headers=["*"],
            ),
        )

        query_integration = apigwv2_integrations.HttpLambdaIntegration(
            "QueryHandlerIntegration", query_fn
        )
        relay_integration = apigwv2_integrations.HttpLambdaIntegration(
            "RelayEventsIntegration", relay_fn
        )
        status_integration = apigwv2_integrations.HttpLambdaIntegration(
            "StatusHandlerIntegration", status_fn
        )

        http_api.add_routes(
            path="/stations/{station_id}/events",
            methods=[apigwv2.HttpMethod.GET],
            integration=query_integration,
        )
        http_api.add_routes(
            path="/events",
            methods=[apigwv2.HttpMethod.POST],
            integration=relay_integration,
        )
        http_api.add_routes(
            path="/status",
            methods=[apigwv2.HttpMethod.GET],
            integration=status_integration,
        )

        self.http_api = http_api
        self.ingest_queue = ingest_queue
        self.ingest_dlq = dlq
        self.readings_table = readings_table
