import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

// Sibling backend/ folder is built by a separate agent; infra only references it as an asset.
const BACKEND_LAMBDAS_DIR = path.join(__dirname, '..', '..', 'backend', 'lambdas');

export class GridPulseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Shard count is the scaling lever for this stack; override via -c shardCount=N (default 4 — see load/results.md).
    const shardCount = Number(this.node.tryGetContext('shardCount')) || 4;
    const telemetryStream = new kinesis.Stream(this, 'GridPulseTelemetryStream', {
      streamName: 'gridpulse-telemetry-stream',
      shardCount,
    });

    const readingsTable = new dynamodb.Table(this, 'GridPulseHubSensorReadings', {
      tableName: 'GridPulseHubSensorReadings',
      partitionKey: { name: 'hubId', type: dynamodb.AttributeType.STRING },
      // '#' matches the composite metricType#timestamp SK the ingest/query lambdas read and write
      sortKey: { name: 'metricType#timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const curtailmentTable = new dynamodb.Table(this, 'GridPulseCurtailmentEvents', {
      tableName: 'GridPulseCurtailmentEvents',
      partitionKey: { name: 'hubId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // single-item counter table backing the dashboard's real message-count metrics
    const opsCountersTable = new dynamodb.Table(this, 'GridPulseOpsCounters', {
      tableName: 'GridPulseOpsCounters',
      partitionKey: { name: 'counterId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const commonEnv = {
      GRIDPULSE_READINGS_TABLE: readingsTable.tableName,
      GRIDPULSE_CURTAILMENT_TABLE: curtailmentTable.tableName,
      GRIDPULSE_OPS_COUNTERS_TABLE: opsCountersTable.tableName,
      GRIDPULSE_STREAM_NAME: telemetryStream.streamName,
    };

    const ingestHubTelemetryFn = new lambda.Function(this, 'IngestHubTelemetryFunction', {
      functionName: 'gridpulse-ingestHubTelemetry',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(BACKEND_LAMBDAS_DIR, 'ingestHubTelemetry')),
      environment: commonEnv,
    });

    // Batch size 10 balances ingest latency against per-invocation DynamoDB write cost.
    ingestHubTelemetryFn.addEventSource(new KinesisEventSource(telemetryStream, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
    }));
    readingsTable.grantReadWriteData(ingestHubTelemetryFn);
    curtailmentTable.grantReadWriteData(ingestHubTelemetryFn);
    opsCountersTable.grantReadWriteData(ingestHubTelemetryFn);

    const hubSummaryApiFn = new lambda.Function(this, 'HubSummaryApiFunction', {
      functionName: 'gridpulse-hubSummaryApi',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(BACKEND_LAMBDAS_DIR, 'hubSummaryApi')),
      environment: commonEnv,
    });
    readingsTable.grantReadData(hubSummaryApiFn);
    curtailmentTable.grantReadData(hubSummaryApiFn);

    const bayControlApiFn = new lambda.Function(this, 'BayControlApiFunction', {
      functionName: 'gridpulse-bayControlApi',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(BACKEND_LAMBDAS_DIR, 'bayControlApi')),
      environment: commonEnv,
    });
    readingsTable.grantReadData(bayControlApiFn);
    curtailmentTable.grantReadData(bayControlApiFn);

    const healthApiFn = new lambda.Function(this, 'HealthApiFunction', {
      functionName: 'gridpulse-healthApi',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(BACKEND_LAMBDAS_DIR, 'healthApi')),
      environment: commonEnv,
    });
    readingsTable.grantReadData(healthApiFn);
    curtailmentTable.grantReadData(healthApiFn);
    opsCountersTable.grantReadData(healthApiFn);
    telemetryStream.grantRead(healthApiFn);

    const httpApi = new apigatewayv2.HttpApi(this, 'GridPulseHttpApi', {
      apiName: 'gridpulse-api',
      // dashboard fetches this API directly from the browser, so CORS must be open for GET
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET],
      },
    });

    httpApi.addRoutes({
      path: '/hubs/{hubId}/summary',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('HubSummaryIntegration', hubSummaryApiFn),
    });

    httpApi.addRoutes({
      path: '/hubs/{hubId}/bays',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('BayControlIntegration', bayControlApiFn),
    });

    httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', healthApiFn),
    });

    new cdk.CfnOutput(this, 'HttpApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'TelemetryStreamName', { value: telemetryStream.streamName });
  }
}
