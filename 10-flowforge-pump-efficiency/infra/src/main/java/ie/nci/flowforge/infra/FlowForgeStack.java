package ie.nci.flowforge.infra;

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
import software.amazon.awscdk.services.dynamodb.GlobalSecondaryIndexProps;
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
 * Provisions the FlowForge backend: insight queue (with DLQ), the pump insights
 * table (with a site-scoped GSI), the ingest/query/relay Lambdas, and the public
 * HTTP API that lets the fog dispatcher's POST and the dashboard's GET both reach it.
 */
public class FlowForgeStack extends Stack {

    private static final String BACKEND_JAR_PATH = "../backend/target/backend-1.0.0.jar";

    private static final String QUEUE_NAME = "flowforge-insight-queue";
    private static final String DLQ_NAME = "flowforge-insight-dlq";
    private static final String TABLE_NAME = "flowforge-insights-table";
    private static final String SITE_INDEX_NAME = "SiteIdIndex";
    private static final String INSIGHTS_TABLE_ENV_VAR = "FLOWFORGE_INSIGHTS_TABLE";
    private static final String TARGET_QUEUE_ENV_VAR = "FLOWFORGE_TARGET_QUEUE_URL";

    // Scalability mechanism (see load/results.md): caps concurrent SQS-triggered invocations of
    // the insight-ingest path so DynamoDB write capacity isn't overrun by a burst of fog dispatches.
    private static final int INGEST_RESERVED_CONCURRENCY = 20;

    public FlowForgeStack(final Construct scope, final String id) {
        this(scope, id, null);
    }

    public FlowForgeStack(final Construct scope, final String id, final StackProps props) {
        super(scope, id, props);

        Queue insightQueue = createInsightQueue();
        Table insightsTable = createInsightsTable();

        Map<String, String> tableEnv = Map.of(INSIGHTS_TABLE_ENV_VAR, TABLE_NAME);

        Function ingestHandler = new Function(this, "IngestEventHandler", FunctionProps.builder()
                .functionName("IngestEventHandler")
                .runtime(Runtime.JAVA_21)
                .handler("ie.nci.flowforge.backend.handlers.IngestEventHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                .reservedConcurrentExecutions(INGEST_RESERVED_CONCURRENCY)
                .environment(tableEnv)
                .build());

        Function queryHandler = new Function(this, "QueryApiHandler", FunctionProps.builder()
                .functionName("QueryApiHandler")
                .runtime(Runtime.JAVA_21)
                .handler("ie.nci.flowforge.backend.handlers.QueryApiHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(tableEnv)
                .build());

        insightsTable.grantWriteData(ingestHandler);
        insightsTable.grantReadData(queryHandler);

        ingestHandler.addEventSource(new SqsEventSource(insightQueue, SqsEventSourceProps.builder()
                .batchSize(10)
                .build()));

        Function insightRelayHandler = relayHandler(insightQueue);

        wireHttpApi(queryHandler, insightRelayHandler);
    }

    private Queue createInsightQueue() {
        Queue dlq = new Queue(this, "InsightDlq", QueueProps.builder()
                .queueName(DLQ_NAME)
                .build());

        return new Queue(this, "InsightQueue", QueueProps.builder()
                .queueName(QUEUE_NAME)
                .deadLetterQueue(DeadLetterQueue.builder()
                        .queue(dlq)
                        .maxReceiveCount(5)
                        .build())
                .build());
    }

    private Table createInsightsTable() {
        Table table = new Table(this, "InsightsTable", TableProps.builder()
                .tableName(TABLE_NAME)
                .partitionKey(Attribute.builder().name("pumpId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("eventTypeTimestamp").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());

        // Lets the dashboard query all insights for a site without scanning the whole table.
        table.addGlobalSecondaryIndex(GlobalSecondaryIndexProps.builder()
                .indexName(SITE_INDEX_NAME)
                .partitionKey(Attribute.builder().name("siteId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("eventTypeTimestamp").type(AttributeType.STRING).build())
                .build());

        return table;
    }

    private Function relayHandler(Queue targetQueue) {
        Function function = new Function(this, "InsightRelayHandler", FunctionProps.builder()
                .functionName("InsightRelayHandler")
                .runtime(Runtime.JAVA_21)
                .handler("ie.nci.flowforge.backend.handlers.InsightRelayHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(Map.of(TARGET_QUEUE_ENV_VAR, targetQueue.getQueueUrl()))
                .build());

        targetQueue.grantSendMessages(function);
        return function;
    }

    private void wireHttpApi(Function queryHandler, Function insightRelayHandler) {
        HttpApi api = new HttpApi(this, "FlowForgeHttpApi", HttpApiProps.builder()
                .apiName("flowforge-pump-api")
                .corsPreflight(CorsPreflightOptions.builder()
                        .allowOrigins(List.of("*"))
                        .allowMethods(List.of(CorsHttpMethod.GET, CorsHttpMethod.POST))
                        .build())
                .build());

        HttpLambdaIntegration queryIntegration =
                new HttpLambdaIntegration("QueryApiIntegration", queryHandler);

        api.addRoutes(AddRoutesOptions.builder()
                .path("/pumps/{pumpId}/insights")
                .methods(List.of(HttpMethod.GET))
                .integration(queryIntegration)
                .build());

        // the endpoint InsightDispatcher actually POSTs to - without this route the fog layer's HTTP call 404s
        api.addRoutes(AddRoutesOptions.builder()
                .path("/insights")
                .methods(List.of(HttpMethod.POST))
                .integration(new HttpLambdaIntegration("InsightRelayIntegration", insightRelayHandler))
                .build());
    }
}
