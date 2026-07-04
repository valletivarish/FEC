package edu.msc.floodwatch.infra;

import java.util.List;
import java.util.Map;

import software.amazon.awscdk.Duration;
import software.amazon.awscdk.RemovalPolicy;
import software.amazon.awscdk.Stack;
import software.amazon.awscdk.StackProps;
import software.amazon.awscdk.aws_apigatewayv2_integrations.HttpLambdaIntegration;
import software.amazon.awscdk.services.apigatewayv2.AddRoutesOptions;
import software.amazon.awscdk.services.apigatewayv2.CorsHttpMethod;
import software.amazon.awscdk.services.apigatewayv2.CorsPreflightOptions;
import software.amazon.awscdk.services.apigatewayv2.HttpApi;
import software.amazon.awscdk.services.apigatewayv2.HttpApiProps;
import software.amazon.awscdk.services.apigatewayv2.HttpMethod;
import software.amazon.awscdk.services.dynamodb.Attribute;
import software.amazon.awscdk.services.dynamodb.AttributeType;
import software.amazon.awscdk.services.dynamodb.BillingMode;
import software.amazon.awscdk.services.dynamodb.Table;
import software.amazon.awscdk.services.dynamodb.TableProps;
import software.amazon.awscdk.services.lambda.Code;
import software.amazon.awscdk.services.lambda.Function;
import software.amazon.awscdk.services.lambda.FunctionProps;
import software.amazon.awscdk.services.lambda.Runtime;
import software.amazon.awscdk.services.lambda.eventsources.SqsEventSource;
import software.amazon.awscdk.services.lambda.eventsources.SqsEventSourceProps;
import software.amazon.awscdk.services.sqs.DeadLetterQueue;
import software.amazon.awscdk.services.sqs.Queue;
import software.amazon.awscdk.services.sqs.QueueProps;
import software.constructs.Construct;

/**
 * Provisions the FloodWatch backend: gauge-intake queue (with DLQ), the reach-stage
 * table, the intake/status Lambdas, and the public HTTP API the dashboard polls.
 */
public class FloodWatchStack extends Stack {

    private static final String BACKEND_JAR_PATH = "../backend/target/backend-1.0.0.jar";

    private static final String QUEUE_NAME = "floodwatch-gauge-intake-queue";
    private static final String DLQ_NAME = "floodwatch-gauge-intake-dlq";
    private static final String TABLE_NAME = "floodwatch-reach-stage";
    private static final String STAGE_TABLE_ENV_VAR = "FLOODWATCH_STAGE_TABLE";
    private static final String INTAKE_QUEUE_URL_ENV_VAR = "FLOODWATCH_INTAKE_QUEUE_URL";

    // scalability mechanism under test: reserved concurrency caps how many gauge-intake
    // invocations run in parallel, trading throughput for a hard ceiling on backend load;
    // read at synth time so the same stack can be redeployed constrained vs. unconstrained
    private static final String RESERVED_CONCURRENCY_ENV_VAR = "FLOODWATCH_INTAKE_RESERVED_CONCURRENCY";

    public FloodWatchStack(final Construct scope, final String id) {
        this(scope, id, null);
    }

    public FloodWatchStack(final Construct scope, final String id, final StackProps props) {
        super(scope, id, props);

        Queue intakeQueue = createGaugeIntakeQueue();
        Table reachStageTable = createReachStageTable();

        Map<String, String> tableEnv = Map.of(STAGE_TABLE_ENV_VAR, TABLE_NAME);

        FunctionProps.Builder intakeHandlerProps = FunctionProps.builder()
                .functionName("ReachIntakeHandler")
                .runtime(Runtime.JAVA_21)
                .handler("edu.msc.floodwatch.backend.ingest.ReachIntakeHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                .environment(tableEnv);

        String reservedConcurrency = System.getenv(RESERVED_CONCURRENCY_ENV_VAR);
        if (reservedConcurrency != null && !reservedConcurrency.isBlank()) {
            intakeHandlerProps.reservedConcurrentExecutions(Integer.parseInt(reservedConcurrency.trim()));
        }

        Function intakeHandler = new Function(this, "ReachIntakeHandler", intakeHandlerProps.build());

        Function statusHandler = new Function(this, "ReachStatusHandler", FunctionProps.builder()
                .functionName("ReachStatusHandler")
                .runtime(Runtime.JAVA_21)
                .handler("edu.msc.floodwatch.backend.api.ReachStatusHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(tableEnv)
                .build());

        Function eventRelayHandler = new Function(this, "ReachEventRelayHandler", FunctionProps.builder()
                .functionName("ReachEventRelayHandler")
                .runtime(Runtime.JAVA_21)
                .handler("edu.msc.floodwatch.backend.ingest.ReachEventRelayHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(Map.of(INTAKE_QUEUE_URL_ENV_VAR, intakeQueue.getQueueUrl()))
                .build());

        Map<String, String> healthEnv = Map.of(
                STAGE_TABLE_ENV_VAR, TABLE_NAME,
                INTAKE_QUEUE_URL_ENV_VAR, intakeQueue.getQueueUrl());

        Function healthHandler = new Function(this, "BackendHealthHandler", FunctionProps.builder()
                .functionName("BackendHealthHandler")
                .runtime(Runtime.JAVA_21)
                .handler("edu.msc.floodwatch.backend.api.BackendHealthHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(healthEnv)
                .build());

        Function metricsHandler = new Function(this, "BackendMetricsHandler", FunctionProps.builder()
                .functionName("BackendMetricsHandler")
                .runtime(Runtime.JAVA_21)
                .handler("edu.msc.floodwatch.backend.api.BackendMetricsHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(tableEnv)
                .build());

        reachStageTable.grantWriteData(intakeHandler);
        reachStageTable.grantReadData(statusHandler);
        reachStageTable.grantReadData(metricsHandler);
        intakeQueue.grantSendMessages(eventRelayHandler);
        // read-only DescribeTable/GetQueueAttributes only, matching the least-privilege
        // pattern the queue/table grants above already establish for every other handler
        reachStageTable.grant(healthHandler, "dynamodb:DescribeTable");
        intakeQueue.grant(healthHandler, "sqs:GetQueueAttributes");

        intakeHandler.addEventSource(new SqsEventSource(intakeQueue, SqsEventSourceProps.builder()
                .batchSize(10)
                .build()));

        wireHttpApi(statusHandler, eventRelayHandler, healthHandler, metricsHandler);
    }

    private Queue createGaugeIntakeQueue() {
        Queue dlq = new Queue(this, "GaugeIntakeDlq", QueueProps.builder()
                .queueName(DLQ_NAME)
                .build());

        return new Queue(this, "GaugeIntakeQueue", QueueProps.builder()
                .queueName(QUEUE_NAME)
                .deadLetterQueue(DeadLetterQueue.builder()
                        .queue(dlq)
                        .maxReceiveCount(5)
                        .build())
                .build());
    }

    private Table createReachStageTable() {
        return new Table(this, "ReachStageTable", TableProps.builder()
                .tableName(TABLE_NAME)
                .partitionKey(Attribute.builder().name("reachId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("eventTypeTimestamp").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());
    }

    private void wireHttpApi(Function statusHandler, Function eventRelayHandler,
            Function healthHandler, Function metricsHandler) {
        // dashboard fetches this API directly from the browser, so CORS must be open for GET
        HttpApi api = new HttpApi(this, "FloodWatchHttpApi", HttpApiProps.builder()
                .apiName("floodwatch-reach-api")
                .corsPreflight(CorsPreflightOptions.builder()
                        .allowOrigins(List.of("*"))
                        .allowMethods(List.of(CorsHttpMethod.GET))
                        .build())
                .build());

        HttpLambdaIntegration statusIntegration =
                new HttpLambdaIntegration("ReachStatusIntegration", statusHandler);

        api.addRoutes(AddRoutesOptions.builder()
                .path("/reaches/{reachId}/status")
                .methods(List.of(HttpMethod.GET))
                .integration(statusIntegration)
                .build());

        HttpLambdaIntegration eventRelayIntegration =
                new HttpLambdaIntegration("ReachEventRelayIntegration", eventRelayHandler);

        api.addRoutes(AddRoutesOptions.builder()
                .path("/events")
                .methods(List.of(HttpMethod.POST))
                .integration(eventRelayIntegration)
                .build());

        HttpLambdaIntegration healthIntegration =
                new HttpLambdaIntegration("BackendHealthIntegration", healthHandler);

        api.addRoutes(AddRoutesOptions.builder()
                .path("/health")
                .methods(List.of(HttpMethod.GET))
                .integration(healthIntegration)
                .build());

        HttpLambdaIntegration metricsIntegration =
                new HttpLambdaIntegration("BackendMetricsIntegration", metricsHandler);

        api.addRoutes(AddRoutesOptions.builder()
                .path("/metrics")
                .methods(List.of(HttpMethod.GET))
                .integration(metricsIntegration)
                .build());
    }
}
