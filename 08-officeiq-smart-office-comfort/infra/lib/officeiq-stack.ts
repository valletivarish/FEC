import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';

export interface OfficeIqStackProps extends cdk.StackProps {
  // overrides the worker container source; local floci deploys pre-push an image and pass an
  // ECR repo name here because floci's STS AssumeRole response isn't accepted by the CDK CLI's
  // asset-publishing SDK client, so the normal fromAsset() Docker-build-and-push path can't run
  readonly workerImageEcrRepositoryName?: string;
  readonly workerImageTag?: string;
  // floci's Fargate task runtime doesn't inject AWS_REGION/AWS_ENDPOINT_URL the way real Fargate's
  // execution environment does, so the worker container needs them passed explicitly for local runs
  readonly extraWorkerEnvironment?: { [key: string]: string };
}

export class OfficeIqStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: OfficeIqStackProps) {
    super(scope, id, props);

    // DLQ catches events a worker fails to process 5 times, keeping the main queue unblocked
    const deadLetterQueue = new sqs.Queue(this, 'OfficeIqEventDlq', {
      queueName: 'officeiq-event-dlq',
    });

    const eventQueue = new sqs.Queue(this, 'OfficeIqEventQueue', {
      queueName: 'officeiq-event-queue',
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 5,
      },
    });

    const table = new dynamodb.Table(this, 'OfficeIqReadingsTable', {
      tableName: 'OfficeIQReadings',
      partitionKey: { name: 'zoneId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventTypeTimestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // No NAT gateway: demo deployment, Fargate tasks get public IPs instead to reach SQS/DynamoDB
    const vpc = new ec2.Vpc(this, 'OfficeIqVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, 'OfficeIqCluster', { vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'OfficeIqWorkerTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    const workerImage = props?.workerImageEcrRepositoryName
      ? ecs.ContainerImage.fromEcrRepository(
          ecr.Repository.fromRepositoryName(this, 'OfficeIqWorkerImageRepo', props.workerImageEcrRepositoryName),
          props.workerImageTag ?? 'latest',
        )
      : ecs.ContainerImage.fromAsset('../backend/worker');

    taskDefinition.addContainer('WorkerContainer', {
      image: workerImage,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'officeiq-worker' }),
      environment: {
        OFFICEIQ_READINGS_TABLE: table.tableName,
        OFFICEIQ_EVENT_QUEUE_URL: eventQueue.queueUrl,
        ...props?.extraWorkerEnvironment,
      },
    });

    const workerService = new ecs.FargateService(this, 'OfficeIqWorkerService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    eventQueue.grantConsumeMessages(taskDefinition.taskRole);
    table.grantWriteData(taskDefinition.taskRole);

    // Step scaling on queue depth is the literal scalability mechanism this project demonstrates
    const scaling = workerService.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 8 });
    scaling.scaleOnMetric('QueueDepthScaling', {
      metric: eventQueue.metricApproximateNumberOfMessagesVisible(),
      scalingSteps: [
        { upper: 0, change: -8 },
        { lower: 1, upper: 20, change: 0 },
        { lower: 20, upper: 50, change: +3 },
        { lower: 50, change: +7 },
      ] as appscaling.ScalingInterval[],
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      cooldown: cdk.Duration.seconds(60),
    });

    const getZoneStatusFn = new lambda.Function(this, 'GetZoneStatusFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handlers/getZoneStatus.handler',
      code: lambda.Code.fromAsset('../backend/api'),
      environment: {
        OFFICEIQ_READINGS_TABLE: table.tableName,
      },
    });

    const getZoneHistoryFn = new lambda.Function(this, 'GetZoneHistoryFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handlers/getZoneHistory.handler',
      code: lambda.Code.fromAsset('../backend/api'),
      environment: {
        OFFICEIQ_READINGS_TABLE: table.tableName,
      },
    });

    table.grantReadData(getZoneStatusFn);
    table.grantReadData(getZoneHistoryFn);

    // fronts the queue so fog nodes can POST over HTTP; forwards the raw body, no re-validation here
    const postEventFn = new lambda.Function(this, 'PostEventFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handlers/postEvent.handler',
      code: lambda.Code.fromAsset('../backend/api'),
      environment: {
        OFFICEIQ_EVENT_QUEUE_URL: eventQueue.queueUrl,
      },
    });

    eventQueue.grantSendMessages(postEventFn);

    const httpApi = new apigwv2.HttpApi(this, 'OfficeIqHttpApi', {
      apiName: 'officeiq-api',
    });

    httpApi.addRoutes({
      path: '/zones/{zoneId}/status',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        'GetZoneStatusIntegration',
        getZoneStatusFn,
      ),
    });

    httpApi.addRoutes({
      path: '/zones/{zoneId}/history',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        'GetZoneHistoryIntegration',
        getZoneHistoryFn,
      ),
    });

    httpApi.addRoutes({
      path: '/events',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        'PostEventIntegration',
        postEventFn,
      ),
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'EventQueueUrl', { value: eventQueue.queueUrl });
    new cdk.CfnOutput(this, 'ReadingsTableName', { value: table.tableName });
  }
}
