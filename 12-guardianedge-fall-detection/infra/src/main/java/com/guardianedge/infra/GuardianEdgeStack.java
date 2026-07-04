package com.guardianedge.infra;

import java.util.List;
import java.util.Map;

import software.amazon.awscdk.Duration;
import software.amazon.awscdk.RemovalPolicy;
import software.amazon.awscdk.Stack;
import software.amazon.awscdk.StackProps;
import software.amazon.awscdk.aws_apigatewayv2_integrations.HttpLambdaIntegration;
import software.amazon.awscdk.services.apigatewayv2.AddRoutesOptions;
import software.amazon.awscdk.services.apigatewayv2.HttpApi;
import software.amazon.awscdk.services.apigatewayv2.HttpApiProps;
import software.amazon.awscdk.services.apigatewayv2.HttpMethod;
import software.amazon.awscdk.services.dynamodb.Attribute;
import software.amazon.awscdk.services.dynamodb.AttributeType;
import software.amazon.awscdk.services.dynamodb.BillingMode;
import software.amazon.awscdk.services.dynamodb.GlobalSecondaryIndexProps;
import software.amazon.awscdk.services.dynamodb.StreamViewType;
import software.amazon.awscdk.services.dynamodb.Table;
import software.amazon.awscdk.services.dynamodb.TableProps;
import software.amazon.awscdk.services.lambda.Code;
import software.amazon.awscdk.services.lambda.Function;
import software.amazon.awscdk.services.lambda.FunctionProps;
import software.amazon.awscdk.services.lambda.Runtime;
import software.amazon.awscdk.services.lambda.StartingPosition;
import software.amazon.awscdk.services.lambda.eventsources.DynamoEventSource;
import software.amazon.awscdk.services.lambda.eventsources.DynamoEventSourceProps;
import software.amazon.awscdk.services.lambda.eventsources.SqsEventSource;
import software.amazon.awscdk.services.lambda.eventsources.SqsEventSourceProps;
import software.amazon.awscdk.services.sqs.DeadLetterQueue;
import software.amazon.awscdk.services.sqs.Queue;
import software.amazon.awscdk.services.sqs.QueueProps;
import software.constructs.Construct;

/**
 * Provisions the GuardianEdge backend: FIFO alert queue (with FIFO DLQ), the
 * event-history and resident-status tables, the ingest/alert-processor/query
 * Lambdas, and the public HTTP API the dashboard polls for resident state.
 */
public class GuardianEdgeStack extends Stack {

    private static final String BACKEND_JAR_PATH = "../backend/target/backend-1.0.0.jar";

    private static final String QUEUE_NAME = "guardianedge-alert-queue.fifo";
    private static final String DLQ_NAME = "guardianedge-alert-dlq.fifo";
    private static final String HISTORY_TABLE_NAME = "guardianedge-event-history-table";
    private static final String STATUS_TABLE_NAME = "guardianedge-resident-status-table";
    private static final String STATUS_INDEX_NAME = "StatusIndex";
    private static final String HISTORY_TABLE_ENV_VAR = "GUARDIANEDGE_HISTORY_TABLE";
    private static final String STATUS_TABLE_ENV_VAR = "GUARDIANEDGE_STATUS_TABLE";
    private static final String ALERT_QUEUE_URL_ENV_VAR = "GUARDIANEDGE_ALERT_QUEUE_URL";

    public GuardianEdgeStack(final Construct scope, final String id) {
        this(scope, id, null);
    }

    public GuardianEdgeStack(final Construct scope, final String id, final StackProps props) {
        super(scope, id, props);

        Queue alertQueue = createAlertQueue();
        Table historyTable = createEventHistoryTable();
        Table statusTable = createResidentStatusTable();

        Map<String, String> bothTablesEnv = Map.of(
                HISTORY_TABLE_ENV_VAR, HISTORY_TABLE_NAME,
                STATUS_TABLE_ENV_VAR, STATUS_TABLE_NAME);

        Function ingestHandler = new Function(this, "IngestEventHandler", FunctionProps.builder()
                .functionName("IngestEventHandler")
                .runtime(Runtime.JAVA_21)
                .handler("com.guardianedge.backend.handlers.IngestEventHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                .environment(bothTablesEnv)
                .build());

        Function alertProcessorHandler = new Function(this, "AlertProcessorHandler", FunctionProps.builder()
                .functionName("AlertProcessorHandler")
                .runtime(Runtime.JAVA_21)
                .handler("com.guardianedge.backend.handlers.AlertProcessorHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                .environment(Map.of(STATUS_TABLE_ENV_VAR, STATUS_TABLE_NAME))
                .build());

        Function queryResidentsHandler = new Function(this, "QueryResidentsHandler", FunctionProps.builder()
                .functionName("QueryResidentsHandler")
                .runtime(Runtime.JAVA_21)
                .handler("com.guardianedge.backend.handlers.QueryResidentsHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(bothTablesEnv)
                .build());

        // Fronts the alert queue so the fog dispatcher's POST has an actual HTTP path to hit.
        Function eventRelayHandler = new Function(this, "EventRelayHandler", FunctionProps.builder()
                .functionName("EventRelayHandler")
                .runtime(Runtime.JAVA_21)
                .handler("com.guardianedge.backend.handlers.EventRelayHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(Map.of(ALERT_QUEUE_URL_ENV_VAR, alertQueue.getQueueUrl()))
                .build());

        // Real DynamoDB/SQS reachability probe backing the dashboard's Backend Status page.
        Function healthCheckHandler = new Function(this, "HealthCheckHandler", FunctionProps.builder()
                .functionName("HealthCheckHandler")
                .runtime(Runtime.JAVA_21)
                .handler("com.guardianedge.backend.handlers.HealthCheckHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(Map.of(
                        HISTORY_TABLE_ENV_VAR, HISTORY_TABLE_NAME,
                        STATUS_TABLE_ENV_VAR, STATUS_TABLE_NAME,
                        ALERT_QUEUE_URL_ENV_VAR, alertQueue.getQueueUrl()))
                .build());

        historyTable.grantWriteData(ingestHandler);
        statusTable.grantWriteData(ingestHandler);
        statusTable.grantWriteData(alertProcessorHandler);
        historyTable.grantReadWriteData(queryResidentsHandler);
        statusTable.grantReadWriteData(queryResidentsHandler);
        alertQueue.grantSendMessages(eventRelayHandler);
        historyTable.grantReadData(healthCheckHandler);
        statusTable.grantReadData(healthCheckHandler);
        alertQueue.grant(healthCheckHandler, "sqs:GetQueueAttributes");

        ingestHandler.addEventSource(new SqsEventSource(alertQueue, SqsEventSourceProps.builder()
                .batchSize(10)
                .build()));

        // Alert processor reacts to inserts on the history table, not the queue directly.
        alertProcessorHandler.addEventSource(new DynamoEventSource(historyTable, DynamoEventSourceProps.builder()
                .batchSize(10)
                .startingPosition(StartingPosition.LATEST)
                .build()));

        wireHttpApi(queryResidentsHandler, eventRelayHandler);
    }

    private Queue createAlertQueue() {
        Queue dlq = new Queue(this, "AlertDlq", QueueProps.builder()
                .queueName(DLQ_NAME)
                .fifo(true)
                .contentBasedDeduplication(true)
                .build());

        return new Queue(this, "AlertQueue", QueueProps.builder()
                .queueName(QUEUE_NAME)
                .fifo(true)
                .contentBasedDeduplication(true)
                .deadLetterQueue(DeadLetterQueue.builder()
                        .queue(dlq)
                        .maxReceiveCount(5)
                        .build())
                .build());
    }

    private Table createEventHistoryTable() {
        return new Table(this, "EventHistoryTable", TableProps.builder()
                .tableName(HISTORY_TABLE_NAME)
                .partitionKey(Attribute.builder().name("residentId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("eventTypeTimestamp").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .stream(StreamViewType.NEW_IMAGE)
                .timeToLiveAttribute("ttlEpochSeconds")
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());
    }

    private Table createResidentStatusTable() {
        Table table = new Table(this, "ResidentStatusTable", TableProps.builder()
                .tableName(STATUS_TABLE_NAME)
                .partitionKey(Attribute.builder().name("residentId").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());

        // Lets the dashboard find residents currently in a given risk state, most-recent first.
        table.addGlobalSecondaryIndex(GlobalSecondaryIndexProps.builder()
                .indexName(STATUS_INDEX_NAME)
                .partitionKey(Attribute.builder().name("currentRiskState").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("lastUpdated").type(AttributeType.STRING).build())
                .build());

        return table;
    }

    private void wireHttpApi(Function queryResidentsHandler, Function eventRelayHandler) {
        HttpApi api = new HttpApi(this, "GuardianEdgeHttpApi", HttpApiProps.builder()
                .apiName("guardianedge-resident-api")
                .build());

        HttpLambdaIntegration queryIntegration =
                new HttpLambdaIntegration("QueryResidentsIntegration", queryResidentsHandler);

        api.addRoutes(AddRoutesOptions.builder()
                .path("/residents")
                .methods(List.of(HttpMethod.GET))
                .integration(queryIntegration)
                .build());

        api.addRoutes(AddRoutesOptions.builder()
                .path("/residents/{residentId}/history")
                .methods(List.of(HttpMethod.GET))
                .integration(queryIntegration)
                .build());

        api.addRoutes(AddRoutesOptions.builder()
                .path("/residents/{residentId}/acknowledge")
                .methods(List.of(HttpMethod.POST))
                .integration(queryIntegration)
                .build());

        // Matches the path the fog EventDispatcher POSTs to.
        HttpLambdaIntegration eventRelayIntegration =
                new HttpLambdaIntegration("EventRelayIntegration", eventRelayHandler);

        api.addRoutes(AddRoutesOptions.builder()
                .path("/events")
                .methods(List.of(HttpMethod.POST))
                .integration(eventRelayIntegration)
                .build());
    }
}
