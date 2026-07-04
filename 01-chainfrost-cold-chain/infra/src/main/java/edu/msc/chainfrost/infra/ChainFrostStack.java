package edu.msc.chainfrost.infra;

import java.util.HashMap;
import java.util.Map;

import software.amazon.awscdk.Duration;
import software.amazon.awscdk.RemovalPolicy;
import software.amazon.awscdk.Stack;
import software.amazon.awscdk.StackProps;
import software.amazon.awscdk.services.apigateway.Cors;
import software.amazon.awscdk.services.apigateway.CorsOptions;
import software.amazon.awscdk.services.apigateway.LambdaIntegration;
import software.amazon.awscdk.services.apigateway.Resource;
import software.amazon.awscdk.services.apigateway.RestApi;
import software.amazon.awscdk.services.apigateway.RestApiProps;
import software.amazon.awscdk.services.dynamodb.Attribute;
import software.amazon.awscdk.services.dynamodb.AttributeType;
import software.amazon.awscdk.services.dynamodb.BillingMode;
import software.amazon.awscdk.services.dynamodb.Table;
import software.amazon.awscdk.services.dynamodb.TableProps;
import software.amazon.awscdk.services.kinesis.Stream;
import software.amazon.awscdk.services.kinesis.StreamMode;
import software.amazon.awscdk.services.kinesis.StreamProps;
import software.amazon.awscdk.services.lambda.Code;
import software.amazon.awscdk.services.lambda.Function;
import software.amazon.awscdk.services.lambda.FunctionProps;
import software.amazon.awscdk.services.lambda.Runtime;
import software.amazon.awscdk.services.lambda.StartingPosition;
import software.amazon.awscdk.services.lambda.eventsources.KinesisEventSource;
import software.amazon.awscdk.services.lambda.eventsources.KinesisEventSourceProps;
import software.constructs.Construct;

/**
 * Provisions the full ChainFrost backend: telemetry stream, storage tables,
 * ingest/read Lambdas, and the public REST API the dashboard talks to.
 */
public class ChainFrostStack extends Stack {

    private static final String BACKEND_JAR_PATH = "../backend/target/backend-1.0.0.jar";

    private static final String ZONE_TEMP_TABLE_NAME = "ChainFrostZoneTemperatureSeries";
    private static final String SHIPMENTS_TABLE_NAME = "ChainFrostShipments";
    private static final String FAULTS_TABLE_NAME = "ChainFrostFaultEvents";

    public ChainFrostStack(final Construct scope, final String id) {
        this(scope, id, null);
    }

    public ChainFrostStack(final Construct scope, final String id, final StackProps props) {
        super(scope, id, props);

        Stream telemetryStream = createTelemetryStream();
        Table zoneTempTable = createZoneTemperatureTable();
        Table shipmentsTable = createShipmentsTable();
        Table faultsTable = createFaultsTable();

        Map<String, String> tableEnv = new HashMap<>();
        tableEnv.put("CHAINFROST_ZONE_TEMP_TABLE", ZONE_TEMP_TABLE_NAME);
        tableEnv.put("CHAINFROST_SHIPMENTS_TABLE", SHIPMENTS_TABLE_NAME);
        tableEnv.put("CHAINFROST_FAULTS_TABLE", FAULTS_TABLE_NAME);

        Function shipmentEventHandler = createLambda(
                "ShipmentEventHandler",
                "edu.msc.chainfrost.backend.ingest.ShipmentEventHandler::handleRequest",
                tableEnv,
                Duration.seconds(30));

        Function shipmentStatusHandler = createLambda(
                "ShipmentStatusHandler",
                "edu.msc.chainfrost.backend.api.ShipmentStatusHandler::handleRequest",
                tableEnv,
                Duration.seconds(10));

        Function excursionHistoryHandler = createLambda(
                "ExcursionHistoryHandler",
                "edu.msc.chainfrost.backend.api.ExcursionHistoryHandler::handleRequest",
                tableEnv,
                Duration.seconds(10));

        Function fleetHealthHandler = createLambda(
                "FleetHealthHandler",
                "edu.msc.chainfrost.backend.api.FleetHealthHandler::handleRequest",
                tableEnv,
                Duration.seconds(10));

        // Grants keep table access scoped per-handler instead of one shared blanket policy.
        zoneTempTable.grantReadWriteData(shipmentEventHandler);
        shipmentsTable.grantReadWriteData(shipmentEventHandler);
        faultsTable.grantReadWriteData(shipmentEventHandler);

        shipmentsTable.grantReadData(shipmentStatusHandler);
        zoneTempTable.grantReadData(excursionHistoryHandler);
        faultsTable.grantReadData(excursionHistoryHandler);
        shipmentsTable.grantReadData(fleetHealthHandler);
        zoneTempTable.grantReadData(fleetHealthHandler);

        shipmentEventHandler.addEventSource(new KinesisEventSource(telemetryStream,
                KinesisEventSourceProps.builder()
                        .batchSize(100)
                        .startingPosition(StartingPosition.TRIM_HORIZON)
                        .build()));
        telemetryStream.grantRead(shipmentEventHandler);

        wireRestApi(shipmentStatusHandler, excursionHistoryHandler, fleetHealthHandler);
    }

    private Stream createTelemetryStream() {
        // 4 shards: enough parallel ingest lanes to absorb concurrent-truck fan-in
        // without every reefer unit serialising behind a single partition.
        return new Stream(this, "ChainFrostTelemetryStream", StreamProps.builder()
                .streamName("chainfrost-telemetry-stream")
                .shardCount(4)
                .streamMode(StreamMode.PROVISIONED)
                .build());
    }

    private Table createZoneTemperatureTable() {
        return new Table(this, "ChainFrostZoneTemperatureSeriesTable", TableProps.builder()
                .tableName(ZONE_TEMP_TABLE_NAME)
                .partitionKey(Attribute.builder().name("truckId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("zoneTimestamp").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());
    }

    private Table createShipmentsTable() {
        return new Table(this, "ChainFrostShipmentsTable", TableProps.builder()
                .tableName(SHIPMENTS_TABLE_NAME)
                .partitionKey(Attribute.builder().name("shipmentId").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());
    }

    private Table createFaultsTable() {
        return new Table(this, "ChainFrostFaultEventsTable", TableProps.builder()
                .tableName(FAULTS_TABLE_NAME)
                .partitionKey(Attribute.builder().name("truckId").type(AttributeType.STRING).build())
                .sortKey(Attribute.builder().name("eventTimestamp").type(AttributeType.STRING).build())
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .removalPolicy(RemovalPolicy.DESTROY)
                .build());
    }

    private Function createLambda(String id, String handler, Map<String, String> env, Duration timeout) {
        return new Function(this, id, FunctionProps.builder()
                .functionName(id)
                .runtime(Runtime.JAVA_21)
                .handler(handler)
                .code(Code.fromAsset(BACKEND_JAR_PATH))
                .memorySize(512)
                .timeout(timeout)
                .environment(env)
                .build());
    }

    private void wireRestApi(Function shipmentStatusHandler, Function excursionHistoryHandler,
                              Function fleetHealthHandler) {
        RestApi api = new RestApi(this, "ChainFrostFleetApi", RestApiProps.builder()
                .restApiName("chainfrost-fleet-api")
                .defaultCorsPreflightOptions(CorsOptions.builder()
                        .allowOrigins(Cors.ALL_ORIGINS)
                        .allowMethods(Cors.ALL_METHODS)
                        .build())
                .build());

        Resource shipments = api.getRoot().addResource("shipments");
        Resource shipment = shipments.addResource("{shipmentId}");
        shipment.addMethod("GET", new LambdaIntegration(shipmentStatusHandler));

        Resource excursions = shipment.addResource("excursions");
        excursions.addMethod("GET", new LambdaIntegration(excursionHistoryHandler));

        Resource fleet = api.getRoot().addResource("fleet");
        Resource health = fleet.addResource("health");
        health.addMethod("GET", new LambdaIntegration(fleetHealthHandler));
    }
}
