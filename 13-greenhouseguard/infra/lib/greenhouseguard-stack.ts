import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as path from 'path';

export class GreenhouseGuardStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const ingestDlq = new sqs.Queue(this, 'IngestDlq', {
      queueName: 'greenhouseguard-ingest-dlq',
    });

    const ingestQueue = new sqs.Queue(this, 'IngestQueue', {
      queueName: 'greenhouseguard-ingest-queue',
      deadLetterQueue: {
        queue: ingestDlq,
        maxReceiveCount: 5,
      },
    });

    const commandLedgerTable = new dynamodb.Table(this, 'CommandLedgerTable', {
      tableName: 'greenhouseguard-command-ledger-table',
      partitionKey: { name: 'zoneId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const faultsTable = new dynamodb.Table(this, 'FaultsTable', {
      tableName: 'greenhouseguard-faults-table',
      partitionKey: { name: 'zoneId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventTypeTimestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const tableEnv = {
      GREENHOUSEGUARD_COMMAND_LEDGER_TABLE: commandLedgerTable.tableName,
      GREENHOUSEGUARD_FAULTS_TABLE: faultsTable.tableName,
    };

    const ingestEventFn = new lambda.Function(this, 'GreenhouseGuardIngestEventFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/functions/ingestEvent')),
      environment: tableEnv,
      // caps concurrent SQS pollers so a burst of zone traffic queues up (and drains) behind
      // the ingest queue instead of overwhelming DynamoDB with unbounded parallel writes
      reservedConcurrentExecutions: 20,
    });
    commandLedgerTable.grantWriteData(ingestEventFn);
    faultsTable.grantWriteData(ingestEventFn);
    ingestEventFn.addEventSource(new SqsEventSource(ingestQueue, { batchSize: 10 }));

    const queryZoneStatusFn = new lambda.Function(this, 'GreenhouseGuardQueryZoneStatusFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/functions/queryZoneStatus')),
      environment: tableEnv,
    });
    commandLedgerTable.grantReadWriteData(queryZoneStatusFn);
    faultsTable.grantReadWriteData(queryZoneStatusFn);

    const acknowledgeFaultFn = new lambda.Function(this, 'GreenhouseGuardAcknowledgeFaultFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/functions/acknowledgeFault')),
      environment: tableEnv,
    });
    commandLedgerTable.grantReadWriteData(acknowledgeFaultFn);
    faultsTable.grantReadWriteData(acknowledgeFaultFn);

    // real DynamoDB DescribeTable + SQS GetQueueAttributes health checks for the dashboard's
    // Backend Status page - needs describe/read permissions distinct from the CRUD Lambdas above
    const systemStatusFn = new lambda.Function(this, 'GreenhouseGuardSystemStatusFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/functions/systemStatus')),
      environment: {
        ...tableEnv,
        GREENHOUSEGUARD_INGEST_QUEUE_URL: ingestQueue.queueUrl,
      },
    });
    commandLedgerTable.grant(systemStatusFn, 'dynamodb:DescribeTable');
    faultsTable.grant(systemStatusFn, 'dynamodb:DescribeTable');
    faultsTable.grantReadData(systemStatusFn);
    ingestQueue.grant(systemStatusFn, 'sqs:GetQueueAttributes');

    // fog dispatchers only speak HTTP, so this relay is the bridge onto the ingest queue's SQS API
    const relayIngestEventFn = new lambda.Function(this, 'GreenhouseGuardRelayIngestEventFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/functions/relayIngestEvent')),
      environment: {
        GREENHOUSEGUARD_INGEST_QUEUE_URL: ingestQueue.queueUrl,
      },
    });
    ingestQueue.grantSendMessages(relayIngestEventFn);

    const httpApi = new apigatewayv2.HttpApi(this, 'GreenhouseGuardHttpApi');

    httpApi.addRoutes({
      path: '/events',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('RelayIngestEventIntegration', relayIngestEventFn),
    });

    httpApi.addRoutes({
      path: '/zones/{zoneId}/status',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('QueryZoneStatusIntegration', queryZoneStatusFn),
    });

    httpApi.addRoutes({
      path: '/zones/{zoneId}/faults/acknowledge',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('AcknowledgeFaultIntegration', acknowledgeFaultFn),
    });
  }
}
