import os

from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    CfnOutput,
    aws_sqs as sqs,
    aws_lambda as lambda_,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as apigwv2_integrations,
    aws_lambda_event_sources as lambda_event_sources,
    aws_dynamodb as dynamodb,
)
from constructs import Construct


class AquaSentinelStack(Stack):
    """Single-stack deployment: readings/alerts queues, tables, Lambdas and HTTP API."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Readings path: ordinary priority, longer visibility timeout for batch processing.
        readings_dlq = sqs.Queue(
            self,
            "AquaSentinelReadingsDlq",
            queue_name="aquasentinel-readings-dlq",
            retention_period=Duration.days(14),
        )

        readings_queue = sqs.Queue(
            self,
            "AquaSentinelReadingsQueue",
            queue_name="aquasentinel-readings-queue",
            visibility_timeout=Duration.seconds(30),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=5,
                queue=readings_dlq,
            ),
        )

        # Alerts path: higher priority, short visibility timeout so a failed delivery
        # is retried quickly rather than sitting invisible for toxic-severity events.
        alerts_dlq = sqs.Queue(
            self,
            "AquaSentinelAlertsDlq",
            queue_name="aquasentinel-alerts-dlq",
            retention_period=Duration.days(14),
        )

        alerts_queue = sqs.Queue(
            self,
            "AquaSentinelAlertsQueue",
            queue_name="aquasentinel-alerts-queue",
            visibility_timeout=Duration.seconds(10),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=5,
                queue=alerts_dlq,
            ),
        )

        readings_table = dynamodb.Table(
            self,
            "AquaSentinelPondReadings",
            table_name="AquaSentinelPondReadings",
            partition_key=dynamodb.Attribute(
                name="pond_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="metric_type_timestamp", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        alerts_table = dynamodb.Table(
            self,
            "AquaSentinelPondAlerts",
            table_name="AquaSentinelPondAlerts",
            partition_key=dynamodb.Attribute(
                name="pond_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="timestamp", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Backs the dashboard's live running counters (messages received/stored) -- a single
        # ADD-updated item per counter name, distinct from the readings/alerts data tables.
        counters_table = dynamodb.Table(
            self,
            "AquaSentinelSystemCounters",
            table_name="AquaSentinelSystemCounters",
            partition_key=dynamodb.Attribute(
                name="counter_name", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Whole backend/ directory ships as one asset so shared/ resolves as a sibling
        # package under the dotted handler paths below.
        backend_asset = lambda_.Code.from_asset("../backend")

        ingest_readings_fn = lambda_.Function(
            self,
            "IngestReadingsFn",
            function_name="aquasentinel-ingest-readings-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.ingest_readings.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(30),
            environment={
                "AQUASENTINEL_READINGS_TABLE": readings_table.table_name,
                "AQUASENTINEL_COUNTERS_TABLE": counters_table.table_name,
            },
        )
        readings_table.grant_write_data(ingest_readings_fn)
        counters_table.grant_write_data(ingest_readings_fn)
        ingest_readings_fn.add_event_source(
            lambda_event_sources.SqsEventSource(
                readings_queue,
                batch_size=10,
            )
        )

        ingest_alerts_fn = lambda_.Function(
            self,
            "IngestAlertsFn",
            function_name="aquasentinel-ingest-alerts-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.ingest_alerts.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment={
                "AQUASENTINEL_ALERTS_TABLE": alerts_table.table_name,
                "AQUASENTINEL_COUNTERS_TABLE": counters_table.table_name,
            },
        )
        alerts_table.grant_write_data(ingest_alerts_fn)
        counters_table.grant_write_data(ingest_alerts_fn)
        ingest_alerts_fn.add_event_source(
            lambda_event_sources.SqsEventSource(
                alerts_queue,
                batch_size=10,
            )
        )

        pond_query_fn = lambda_.Function(
            self,
            "PondQueryFn",
            function_name="aquasentinel-pond-query-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.pond_query.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment={
                "AQUASENTINEL_READINGS_TABLE": readings_table.table_name,
                "AQUASENTINEL_ALERTS_TABLE": alerts_table.table_name,
            },
        )
        readings_table.grant_read_data(pond_query_fn)
        alerts_table.grant_read_data(pond_query_fn)

        # Additive local-testing fallback: floci's HTTP API v2 router builds a Java named-capturing-group
        # regex straight from each `{param}` path segment (e.g. `(?<pond_id>...)`), but Java rejects
        # underscores in named-group names, so PatternSyntaxException fires before the request ever
        # reaches this Lambda and floci 500s on both /ponds/{pond_id}/status and /ponds/{pond_id}/alerts.
        # A Function URL invokes the Lambda directly with no path-template regex matching involved, so
        # the same broken route pattern never gets built. Only synthesized when explicitly opted into
        # (never on a real deploy, which has no reason to set this) so real AWS gets an identical
        # template to before -- this is purely an extra local entry point, the API Gateway route stays.
        if os.environ.get("AQUASENTINEL_LOCAL_FALLBACK") == "1":
            pond_query_url = pond_query_fn.add_function_url(
                auth_type=lambda_.FunctionUrlAuthType.NONE,
                cors=lambda_.FunctionUrlCorsOptions(
                    allowed_origins=["*"],
                    allowed_methods=[lambda_.HttpMethod.GET],
                ),
            )
            CfnOutput(self, "PondQueryFunctionUrl", value=pond_query_url.url)

        # Operations-console endpoints: real reachability/health checks and real running counters,
        # not part of the pond-domain query path so they stay independently testable.
        system_health_fn = lambda_.Function(
            self,
            "SystemHealthFn",
            function_name="aquasentinel-system-health-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.system_health.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment={
                "AQUASENTINEL_READINGS_TABLE": readings_table.table_name,
                "AQUASENTINEL_ALERTS_TABLE": alerts_table.table_name,
                "AQUASENTINEL_READINGS_QUEUE_URL": readings_queue.queue_url,
                "AQUASENTINEL_ALERTS_QUEUE_URL": alerts_queue.queue_url,
            },
        )
        readings_table.grant_read_data(system_health_fn)
        alerts_table.grant_read_data(system_health_fn)
        readings_queue.grant_consume_messages(system_health_fn)
        alerts_queue.grant_consume_messages(system_health_fn)

        system_metrics_fn = lambda_.Function(
            self,
            "SystemMetricsFn",
            function_name="aquasentinel-system-metrics-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.system_metrics.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(15),
            environment={
                "AQUASENTINEL_READINGS_TABLE": readings_table.table_name,
                "AQUASENTINEL_ALERTS_TABLE": alerts_table.table_name,
                "AQUASENTINEL_COUNTERS_TABLE": counters_table.table_name,
            },
        )
        readings_table.grant_read_data(system_metrics_fn)
        alerts_table.grant_read_data(system_metrics_fn)
        counters_table.grant_read_data(system_metrics_fn)

        # Relay Lambdas give the fog dispatcher's POST /readings and POST /alerts an actual
        # HTTP entry point; they only forward the raw body onto their own queue, no re-validation.
        relay_readings_fn = lambda_.Function(
            self,
            "RelayReadingsFn",
            function_name="aquasentinel-relay-readings-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.relay_readings.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(5),
            environment={
                "AQUASENTINEL_READINGS_QUEUE_URL": readings_queue.queue_url,
            },
        )
        readings_queue.grant_send_messages(relay_readings_fn)

        relay_alerts_fn = lambda_.Function(
            self,
            "RelayAlertsFn",
            function_name="aquasentinel-relay-alerts-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.relay_alerts.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(5),
            environment={
                "AQUASENTINEL_ALERTS_QUEUE_URL": alerts_queue.queue_url,
            },
        )
        alerts_queue.grant_send_messages(relay_alerts_fn)

        http_api = apigwv2.HttpApi(
            self,
            "AquaSentinelHttpApi",
            api_name="aquasentinel-api",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
                allow_headers=["*"],
            ),
        )

        pond_query_integration = apigwv2_integrations.HttpLambdaIntegration(
            "PondQueryIntegration", pond_query_fn
        )

        http_api.add_routes(
            path="/ponds/{pond_id}/status",
            methods=[apigwv2.HttpMethod.GET],
            integration=pond_query_integration,
        )
        http_api.add_routes(
            path="/ponds/{pond_id}/alerts",
            methods=[apigwv2.HttpMethod.GET],
            integration=pond_query_integration,
        )
        http_api.add_routes(
            path="/readings",
            methods=[apigwv2.HttpMethod.POST],
            integration=apigwv2_integrations.HttpLambdaIntegration(
                "RelayReadingsIntegration", relay_readings_fn
            ),
        )
        http_api.add_routes(
            path="/alerts",
            methods=[apigwv2.HttpMethod.POST],
            integration=apigwv2_integrations.HttpLambdaIntegration(
                "RelayAlertsIntegration", relay_alerts_fn
            ),
        )
        http_api.add_routes(
            path="/health",
            methods=[apigwv2.HttpMethod.GET],
            integration=apigwv2_integrations.HttpLambdaIntegration(
                "SystemHealthIntegration", system_health_fn
            ),
        )
        http_api.add_routes(
            path="/metrics",
            methods=[apigwv2.HttpMethod.GET],
            integration=apigwv2_integrations.HttpLambdaIntegration(
                "SystemMetricsIntegration", system_metrics_fn
            ),
        )

        self.http_api = http_api
        self.readings_queue = readings_queue
        self.readings_dlq = readings_dlq
        self.alerts_queue = alerts_queue
        self.alerts_dlq = alerts_dlq
