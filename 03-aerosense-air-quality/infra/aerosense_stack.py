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


class AeroSenseStack(Stack):
    """Single-stack deployment: ingest queue, HTTP API, Lambdas and tables."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        self._advisory_dlq = sqs.Queue(
            self,
            "AeroSenseAdvisoryDlq",
            queue_name="aerosense-advisory-dlq",
            retention_period=Duration.days(14),
        )

        self._advisory_queue = sqs.Queue(
            self,
            "AeroSenseAdvisoryQueue",
            queue_name="aerosense-advisory-queue",
            visibility_timeout=Duration.seconds(30),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=5,
                queue=self._advisory_dlq,
            ),
        )

        self._advisory_table = dynamodb.Table(
            self,
            "AeroSenseAdvisoryEvents",
            table_name="AeroSenseAdvisoryEvents",
            partition_key=dynamodb.Attribute(
                name="zone_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="event_timestamp_sensor", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        self._zone_config_table = dynamodb.Table(
            self,
            "AeroSenseZoneConfig",
            table_name="AeroSenseZoneConfig",
            partition_key=dynamodb.Attribute(
                name="zone_id", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        common_env = {
            "AEROSENSE_ADVISORY_TABLE": self._advisory_table.table_name,
            "AEROSENSE_ZONE_CONFIG_TABLE": self._zone_config_table.table_name,
            "AEROSENSE_ADVISORY_QUEUE_URL": self._advisory_queue.queue_url,
        }

        # All four functions ship from the same backend/ asset (not a separate copy under
        # infra/) so the code under test in backend/tests is exactly the code that deploys.
        backend_asset = lambda_.Code.from_asset("../backend")

        # Stable aws-cdk-lib has no built-in HTTP-API-to-SQS service integration,
        # so a thin Lambda (send_message only) stands in for a direct integration.
        advisory_intake_fn = lambda_.Function(
            self,
            "AdvisoryIntakeFn",
            function_name="aerosense-advisory-intake-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.advisory_intake.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment=common_env,
        )
        self._advisory_queue.grant_send_messages(advisory_intake_fn)

        advisory_ingest_fn = lambda_.Function(
            self,
            "AdvisoryIngestFn",
            function_name="advisory_ingest_fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.advisory_ingest.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(30),
            environment=common_env,
        )
        self._advisory_table.grant_write_data(advisory_ingest_fn)
        advisory_ingest_fn.add_event_source(
            lambda_event_sources.SqsEventSource(
                self._advisory_queue,
                batch_size=10,
            )
        )

        zone_query_fn = lambda_.Function(
            self,
            "ZoneQueryFn",
            function_name="zone_query_fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.zone_query.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment=common_env,
        )
        self._advisory_table.grant_read_data(zone_query_fn)

        zone_config_fn = lambda_.Function(
            self,
            "ZoneConfigFn",
            function_name="zone_config_fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.zone_config.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment=common_env,
        )
        self._zone_config_table.grant_read_write_data(zone_config_fn)

        http_api = apigwv2.HttpApi(
            self,
            "AeroSenseHttpApi",
            api_name="aerosense-api",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[
                    apigwv2.CorsHttpMethod.GET,
                    apigwv2.CorsHttpMethod.PUT,
                    apigwv2.CorsHttpMethod.POST,
                ],
                allow_headers=["*"],
            ),
        )

        advisory_intake_integration = apigwv2_integrations.HttpLambdaIntegration(
            "AdvisoryIntakeIntegration", advisory_intake_fn
        )
        zone_query_integration = apigwv2_integrations.HttpLambdaIntegration(
            "ZoneQueryIntegration", zone_query_fn
        )
        zone_config_integration = apigwv2_integrations.HttpLambdaIntegration(
            "ZoneConfigIntegration", zone_config_fn
        )

        http_api.add_routes(
            path="/advisories",
            methods=[apigwv2.HttpMethod.POST],
            integration=advisory_intake_integration,
        )
        http_api.add_routes(
            path="/zones/{zone_id}/status",
            methods=[apigwv2.HttpMethod.GET],
            integration=zone_query_integration,
        )
        http_api.add_routes(
            path="/zones/{zone_id}/history",
            methods=[apigwv2.HttpMethod.GET],
            integration=zone_query_integration,
        )
        http_api.add_routes(
            path="/config/{zone_id}",
            methods=[apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT],
            integration=zone_config_integration,
        )

        self.http_api = http_api
        self.advisory_queue = self._advisory_queue
        self.advisory_dlq = self._advisory_dlq
