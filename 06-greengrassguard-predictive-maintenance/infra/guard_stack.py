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
    aws_iam as iam,
)
from constructs import Construct


class GuardStack(Stack):
    """Single-stack deployment: fault-intake queue, diagnosis table, HTTP API and Lambdas."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        dlq = sqs.Queue(
            self,
            "GuardFaultIntakeDlq",
            queue_name="guard-fault-intake-dlq",
            retention_period=Duration.days(14),
        )

        intake_queue = sqs.Queue(
            self,
            "GuardFaultIntakeQueue",
            queue_name="guard-fault-intake-queue",
            visibility_timeout=Duration.seconds(30),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=5,
                queue=dlq,
            ),
        )

        diagnosis_table = dynamodb.Table(
            self,
            "GuardDiagnosisEvents",
            table_name="GuardDiagnosisEvents",
            partition_key=dynamodb.Attribute(
                name="asset_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="event_type_timestamp", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Same keys as the base table: this GSI exists so a future fault-type-only
        # query path is possible without a full table scan, not for a different access pattern yet.
        diagnosis_table.add_global_secondary_index(
            index_name="FaultsByAssetIndex",
            partition_key=dynamodb.Attribute(
                name="asset_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="event_type_timestamp", type=dynamodb.AttributeType.STRING
            ),
        )

        common_env = {
            "GUARD_DIAGNOSIS_TABLE": diagnosis_table.table_name,
        }

        # Whole backend/ directory ships as one asset so shared/ resolves as a sibling
        # package under the dotted handler paths below.
        backend_asset = lambda_.Code.from_asset("../backend")

        intake_fn = lambda_.Function(
            self,
            "IntakeHandlerFn",
            function_name="guard-intake-handler-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.intake_handler.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(30),
            environment=common_env,
        )
        diagnosis_table.grant_write_data(intake_fn)
        intake_fn.add_event_source(
            lambda_event_sources.SqsEventSource(
                intake_queue,
                batch_size=10,
            )
        )

        query_fn = lambda_.Function(
            self,
            # prefixed (unlike the other constructs here) because floci's IAM policy
            # emulation namespaces by construct id, not by stack, and this exact id
            # collided with another deployed project's identically-named construct
            "GuardQueryHandlerFn",
            function_name="guard-query-handler-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.query_handler.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment=common_env,
        )
        diagnosis_table.grant_read_data(query_fn)

        http_api = apigwv2.HttpApi(
            self,
            "GuardHttpApi",
            api_name="greengrassguard-api",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[apigwv2.CorsHttpMethod.GET],
                allow_headers=["*"],
            ),
        )

        query_integration = apigwv2_integrations.HttpLambdaIntegration(
            "QueryHandlerIntegration", query_fn
        )

        http_api.add_routes(
            path="/assets/{asset_id}/diagnoses",
            methods=[apigwv2.HttpMethod.GET],
            integration=query_integration,
        )

        # Fog dispatcher POSTs here; this Lambda only relays onto SQS so intake_fn
        # keeps sole ownership of parsing/validation on the consumer side.
        relay_fn = lambda_.Function(
            self,
            "DiagnosisRelayFn",
            function_name="guard-diagnosis-relay-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.diagnosis_relay.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment={"GUARD_INTAKE_QUEUE_URL": intake_queue.queue_url},
        )
        intake_queue.grant_send_messages(relay_fn)

        relay_integration = apigwv2_integrations.HttpLambdaIntegration(
            "DiagnosisRelayIntegration", relay_fn
        )

        http_api.add_routes(
            path="/diagnoses",
            methods=[apigwv2.HttpMethod.POST],
            integration=relay_integration,
        )

        # relay_fn also owns the messages_received counter, so it needs write access to the
        # same table query_fn/health_fn read from — no separate counters table for two integers.
        diagnosis_table.grant_write_data(relay_fn)
        relay_fn.add_environment("GUARD_DIAGNOSIS_TABLE", diagnosis_table.table_name)

        # Real reachability probe for the dashboard's Backend Status page: DescribeTable +
        # GetQueueAttributes, not a hardcoded "Online" string.
        health_fn = lambda_.Function(
            self,
            "HealthHandlerFn",
            function_name="guard-health-handler-fn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="functions.health_handler.handler.handler",
            code=backend_asset,
            timeout=Duration.seconds(10),
            environment={
                **common_env,
                "GUARD_INTAKE_QUEUE_URL": intake_queue.queue_url,
            },
        )
        diagnosis_table.grant_read_data(health_fn)
        health_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["dynamodb:DescribeTable"],
                resources=[diagnosis_table.table_arn],
            )
        )
        # read-only queue attributes for the health probe — no send/receive/delete needed
        health_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["sqs:GetQueueAttributes"],
                resources=[intake_queue.queue_arn],
            )
        )

        health_integration = apigwv2_integrations.HttpLambdaIntegration(
            "HealthHandlerIntegration", health_fn
        )

        http_api.add_routes(
            path="/health",
            methods=[apigwv2.HttpMethod.GET],
            integration=health_integration,
        )

        self.http_api = http_api
        self.intake_queue = intake_queue
        self.intake_dlq = dlq
        self.diagnosis_table = diagnosis_table
        self.relay_fn = relay_fn
        self.health_fn = health_fn
