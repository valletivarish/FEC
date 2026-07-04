import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export class ParkFogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DLQ catches records that fail processing 5 times so the main queue never blocks
    const deadLetterQueue = new sqs.Queue(this, 'ParkFogBayEventsDlq', {
      queueName: 'parkfog-bay-events-dlq',
    });

    const bayEventsQueue = new sqs.Queue(this, 'ParkFogBayEventsQueue', {
      queueName: 'parkfog-bay-events-queue',
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 5,
      },
    });

    // single-table design: entityId (bay or zone) + type#timestamp sort key covers all 5 event types
    const eventsTable = new dynamodb.Table(this, 'ParkFogEventsTable', {
      tableName: 'parkfog-events-table',
      partitionKey: { name: 'entityId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventTypeTimestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // scalability mechanism: reserved concurrency caps how many ingest invocations run in
    // parallel, load-tested (load/results.md) at 5 vs 20 to show its effect on p95 latency;
    // env var lets the load test flip it without a code change
    const ingestReservedConcurrency = process.env.PARKFOG_INGEST_RESERVED_CONCURRENCY
      ? parseInt(process.env.PARKFOG_INGEST_RESERVED_CONCURRENCY, 10)
      : 5;

    const ingestBayEvents = new lambda.Function(this, 'IngestBayEventsFunction', {
      functionName: 'parkfog-ingest-bay-events',
      runtime: lambda.Runtime.NODEJS_20_X,
      // asset root is the whole backend/ so the `../../lib/*` requires this handler makes resolve at runtime
      handler: 'functions/ingestBayEvents/index.handler',
      code: lambda.Code.fromAsset('../backend', { exclude: ['**/__tests__/**', 'node_modules/aws-sdk-client-mock/**'] }),
      reservedConcurrentExecutions: ingestReservedConcurrency,
      // default 3s is too tight for the DynamoDB round trip under cold start
      timeout: cdk.Duration.seconds(10),
      environment: {
        PARKFOG_EVENTS_TABLE: eventsTable.tableName,
      },
    });
    ingestBayEvents.addEventSource(new SqsEventSource(bayEventsQueue, { batchSize: 10 }));
    // read+write: ingest both writes the event item and ADD-updates the shared counters item
    eventsTable.grantReadWriteData(ingestBayEvents);

    const queryZoneStatus = new lambda.Function(this, 'QueryZoneStatusFunction', {
      functionName: 'parkfog-query-zone-status',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'functions/queryZoneStatus/index.handler',
      code: lambda.Code.fromAsset('../backend', { exclude: ['**/__tests__/**', 'node_modules/aws-sdk-client-mock/**'] }),
      environment: {
        PARKFOG_EVENTS_TABLE: eventsTable.tableName,
        // bay-scoped events are stored under their own bayId entityId, so the query fans out
        // over this roster too; config-only so a new bay never needs a code change
        PARKFOG_ZONE_BAY_IDS: 'bay-01,bay-02,bay-03,bay-04,bay-05,bay-06',
      },
    });
    eventsTable.grantReadData(queryZoneStatus);

    // fronts bayEventsQueue so fog nodes can POST over HTTP; forwards the raw body, ingestBayEvents parses it
    const relayBayEvents = new lambda.Function(this, 'RelayBayEventsFunction', {
      functionName: 'parkfog-relay-bay-events',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../backend/functions/relayBayEvents'),
      environment: {
        PARKFOG_BAY_EVENTS_QUEUE_URL: bayEventsQueue.queueUrl,
      },
    });
    bayEventsQueue.grantSendMessages(relayBayEvents);

    // dashboard's Backend Status page polls this for real DynamoDB/SQS reachability, not a hardcoded string
    const healthCheck = new lambda.Function(this, 'HealthCheckFunction', {
      functionName: 'parkfog-health-check',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'functions/healthCheck/index.handler',
      code: lambda.Code.fromAsset('../backend', { exclude: ['**/__tests__/**', 'node_modules/aws-sdk-client-mock/**'] }),
      environment: {
        PARKFOG_EVENTS_TABLE: eventsTable.tableName,
        PARKFOG_BAY_EVENTS_QUEUE_URL: bayEventsQueue.queueUrl,
      },
    });
    eventsTable.grantReadData(healthCheck);
    bayEventsQueue.grantConsumeMessages(healthCheck);

    // decoupled onto its own schedule so pricing computation never blocks ingestion; reads
    // zone_pressure_event/tariff_changed and only writes a new tariff_changed on a genuine move
    const computeZonePricing = new lambda.Function(this, 'ComputeZonePricingFunction', {
      functionName: 'parkfog-compute-zone-pricing',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'functions/computeZonePricing/index.handler',
      code: lambda.Code.fromAsset('../backend', { exclude: ['**/__tests__/**', 'node_modules/aws-sdk-client-mock/**'] }),
      timeout: cdk.Duration.seconds(10),
      environment: {
        PARKFOG_EVENTS_TABLE: eventsTable.tableName,
      },
    });
    eventsTable.grantReadWriteData(computeZonePricing);

    new events.Rule(this, 'ComputeZonePricingSchedule', {
      ruleName: 'parkfog-compute-zone-pricing-schedule',
      schedule: events.Schedule.rate(cdk.Duration.minutes(2)),
      targets: [new targets.LambdaFunction(computeZonePricing)],
    });

    const httpApi = new apigwv2.HttpApi(this, 'ParkFogHttpApi', {
      apiName: 'parkfog-api',
    });
    httpApi.addRoutes({
      path: '/zones/{zoneId}/status',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('QueryZoneStatusIntegration', queryZoneStatus),
    });
    httpApi.addRoutes({
      path: '/events',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('RelayBayEventsIntegration', relayBayEvents),
    });
    httpApi.addRoutes({
      path: '/health',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthCheckIntegration', healthCheck),
    });

    new cdk.CfnOutput(this, 'ParkFogApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'ParkFogQueueUrl', { value: bayEventsQueue.queueUrl });
    new cdk.CfnOutput(this, 'ParkFogTableName', { value: eventsTable.tableName });
  }
}
