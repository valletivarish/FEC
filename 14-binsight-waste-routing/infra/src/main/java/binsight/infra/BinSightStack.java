package binsight.infra;

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
 * Provisions the BinSight backend: 3 SQS-backed ingest pipelines (cluster
 * verdicts, fire risk, work lists), their DynamoDB tables, the depot-status
 * query Lambda, and the HTTP API that lets the fog dispatcher's POSTs and the
 * dashboard's GET actually reach them.
 */
public class BinSightStack extends Stack {

    private static final String BACKEND_JAR_PATH = "../backend/target/backend-1.0.0.jar";

    private static final String CLUSTER_QUEUE_NAME = "binsight-cluster-verdict-queue";
    private static final String CLUSTER_DLQ_NAME = "binsight-cluster-verdict-dlq";
    private static final String FIRE_RISK_QUEUE_NAME = "binsight-fire-risk-queue";
    private static final String FIRE_RISK_DLQ_NAME = "binsight-fire-risk-dlq";
    private static final String WORK_LIST_QUEUE_NAME = "binsight-work-list-queue";
    private static final String WORK_LIST_DLQ_NAME = "binsight-work-list-dlq";

    private static final String CLUSTER_TABLE_NAME = "binsight-cluster-verdicts-table";
    private static final String FIRE_RISK_TABLE_NAME = "binsight-fire-risk-table";
    private static final String WORK_LIST_TABLE_NAME = "binsight-work-list-table";
    private static final String FIRE_RISK_INDEX_NAME = "RiskStatusIndex";

    private static final String CLUSTER_TABLE_ENV_VAR = "BINSIGHT_CLUSTER_TABLE";
    private static final String FIRE_RISK_TABLE_ENV_VAR = "BINSIGHT_FIRE_RISK_TABLE";
    private static final String WORK_LIST_TABLE_ENV_VAR = "BINSIGHT_WORK_LIST_TABLE";
    private static final String TARGET_QUEUE_ENV_VAR = "BINSIGHT_TARGET_QUEUE_URL";

    // Scalability mechanism under test: reserved concurrency on the fire-risk ingest Lambda,
    // capping how many concurrent executions may drain the fire-risk queue. Config-only (an
    // env var read at synth time), never a code change, so load/results.md's two deploys are
    // the same CDK app with only this value differing - see load/README.md.
    private static final String FIRE_RISK_RESERVED_CONCURRENCY_ENV_VAR = "FIRE_RISK_RESERVED_CONCURRENCY";

    public BinSightStack(final Construct scope, final String id) {
        this(scope, id, null);
    }

    public BinSightStack(final Construct scope, final String id, final StackProps props) {
        super(scope, id, props);

        Queue clusterQueue = createQueueWithDlq("ClusterVerdict", CLUSTER_QUEUE_NAME, CLUSTER_DLQ_NAME);
        Queue fireRiskQueue = createQueueWithDlq("FireRisk", FIRE_RISK_QUEUE_NAME, FIRE_RISK_DLQ_NAME);
        Queue workListQueue = createQueueWithDlq("WorkList", WORK_LIST_QUEUE_NAME, WORK_LIST_DLQ_NAME);

        Table clusterTable = createClusterVerdictsTable();
        Table fireRiskTable = createFireRiskTable();
        Table workListTable = createWorkListTable();

        Function clusterIngestHandler = ingestHandler("ClusterVerdictIngestHandler",
                "binsight.backend.handlers.ClusterVerdictIngestHandler::handleRequest",
                Map.of(CLUSTER_TABLE_ENV_VAR, CLUSTER_TABLE_NAME));
        clusterTable.grantWriteData(clusterIngestHandler);
        clusterIngestHandler.addEventSource(new SqsEventSource(clusterQueue, SqsEventSourceProps.builder()
                .batchSize(10)
                .build()));

        Function fireRiskIngestHandler = fireRiskIngestHandler();
        fireRiskTable.grantWriteData(fireRiskIngestHandler);
        fireRiskIngestHandler.addEventSource(new SqsEventSource(fireRiskQueue, SqsEventSourceProps.builder()
                .batchSize(10)
                .build()));

        Function workListIngestHandler = ingestHandler("WorkListIngestHandler",
                "binsight.backend.handlers.WorkListIngestHandler::handleRequest",
                Map.of(WORK_LIST_TABLE_ENV_VAR, WORK_LIST_TABLE_NAME));
        workListTable.grantWriteData(workListIngestHandler);
        workListIngestHandler.addEventSource(new SqsEventSource(workListQueue, SqsEventSourceProps.builder()
                .batchSize(10)
                .build()));

        Function queryDepotStatusHandler = ingestHandler("QueryDepotStatusHandler",
                "binsight.backend.handlers.QueryDepotStatusHandler::handleRequest",
                Map.of(
                        CLUSTER_TABLE_ENV_VAR, CLUSTER_TABLE_NAME,
                        FIRE_RISK_TABLE_ENV_VAR, FIRE_RISK_TABLE_NAME,
                        WORK_LIST_TABLE_ENV_VAR, WORK_LIST_TABLE_NAME));
        clusterTable.grantReadData(queryDepotStatusHandler);
        fireRiskTable.grantReadData(queryDepotStatusHandler);
        workListTable.grantReadData(queryDepotStatusHandler);

        // Same relay code deployed 3 times, one per queue, distinguished only by target queue URL -
        // this is what lets the fog dispatcher's HTTP POST actually reach the SQS ingest pipeline.
        Function clusterRelayHandler = relayHandler("ClusterVerdictRelayHandler", clusterQueue);
        Function fireRiskRelayHandler = relayHandler("FireRiskRelayHandler", fireRiskQueue);
        Function workListRelayHandler = relayHandler("WorkListRelayHandler", workListQueue);

        wireHttpApi(queryDepotStatusHandler, clusterRelayHandler, fireRiskRelayHandler, workListRelayHandler);
    }

    private Queue createQueueWithDlq(String idPrefix, String queueName, String dlqName) {
        Queue dlq = new Queue(this, idPrefix + "Dlq", QueueProps.builder()
                .queueName(dlqName)
                .build());

        return new Queue(this, idPrefix + "Queue", QueueProps.builder()
                .queueName(queueName)
                .deadLetterQueue(DeadLetterQueue.builder()
                        .queue(dlq)
                        .maxReceiveCount(5)
                        .build())
                .build());
    }

    private Table createClusterVerdictsTable() {
        return new Table(this, "ClusterVerdictsTable", TableProps.builder()
                .tableName(CLUSTER_TABLE_NAME)
                .partitionKey(Attribute.builder().name("binId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("timestamp").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());
    }

    private Table createFireRiskTable() {
        Table table = new Table(this, "FireRiskTable", TableProps.builder()
                .tableName(FIRE_RISK_TABLE_NAME)
                .partitionKey(Attribute.builder().name("binId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("timestamp").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());

        // Lets the dashboard find bins currently at a given fire-risk state, most-recent first.
        table.addGlobalSecondaryIndex(GlobalSecondaryIndexProps.builder()
                .indexName(FIRE_RISK_INDEX_NAME)
                .partitionKey(Attribute.builder().name("riskStatus").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("timestamp").type(AttributeType.STRING).build())
                .build());

        return table;
    }

    private Table createWorkListTable() {
        return new Table(this, "WorkListTable", TableProps.builder()
                .tableName(WORK_LIST_TABLE_NAME)
                .partitionKey(Attribute.builder().name("depotId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("timestamp").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());
    }

    private Function ingestHandler(String id, String handler, Map<String, String> environment) {
        return new Function(this, id, FunctionProps.builder()
                .functionName(id)
                .runtime(Runtime.JAVA_21)
                .handler(handler)
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                .environment(environment)
                .build());
    }

    private Function fireRiskIngestHandler() {
        FunctionProps.Builder builder = FunctionProps.builder()
                .functionName("FireRiskIngestHandler")
                .runtime(Runtime.JAVA_21)
                .handler("binsight.backend.handlers.FireRiskIngestHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(30))
                .environment(Map.of(FIRE_RISK_TABLE_ENV_VAR, FIRE_RISK_TABLE_NAME));

        String reservedConcurrency = System.getenv(FIRE_RISK_RESERVED_CONCURRENCY_ENV_VAR);
        if (reservedConcurrency != null && !reservedConcurrency.isBlank()) {
            builder.reservedConcurrentExecutions(Integer.parseInt(reservedConcurrency.trim()));
        }

        return new Function(this, "FireRiskIngestHandler", builder.build());
    }

    private Function relayHandler(String id, Queue targetQueue) {
        Function function = new Function(this, id, FunctionProps.builder()
                .functionName(id)
                .runtime(Runtime.JAVA_21)
                .handler("binsight.backend.handlers.IngestRelayHandler::handleRequest")
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(Duration.seconds(10))
                .environment(Map.of(TARGET_QUEUE_ENV_VAR, targetQueue.getQueueUrl()))
                .build());

        targetQueue.grantSendMessages(function);
        return function;
    }

    private void wireHttpApi(Function queryDepotStatusHandler, Function clusterRelayHandler,
            Function fireRiskRelayHandler, Function workListRelayHandler) {
        HttpApi api = new HttpApi(this, "BinSightHttpApi", HttpApiProps.builder()
                .apiName("binsight-depot-api")
                .build());

        api.addRoutes(AddRoutesOptions.builder()
                .path("/depot/status")
                .methods(List.of(HttpMethod.GET))
                .integration(new HttpLambdaIntegration("QueryDepotStatusIntegration", queryDepotStatusHandler))
                .build());

        api.addRoutes(AddRoutesOptions.builder()
                .path("/cluster-verdicts")
                .methods(List.of(HttpMethod.POST))
                .integration(new HttpLambdaIntegration("ClusterVerdictRelayIntegration", clusterRelayHandler))
                .build());

        api.addRoutes(AddRoutesOptions.builder()
                .path("/fire-risk")
                .methods(List.of(HttpMethod.POST))
                .integration(new HttpLambdaIntegration("FireRiskRelayIntegration", fireRiskRelayHandler))
                .build());

        api.addRoutes(AddRoutesOptions.builder()
                .path("/work-list")
                .methods(List.of(HttpMethod.POST))
                .integration(new HttpLambdaIntegration("WorkListRelayIntegration", workListRelayHandler))
                .build());
    }
}
