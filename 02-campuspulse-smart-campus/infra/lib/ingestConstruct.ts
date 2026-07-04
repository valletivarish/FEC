import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  RestApi,
  AwsIntegration,
  PassthroughBehavior,
  Model,
} from 'aws-cdk-lib/aws-apigateway';

// Write path skips Lambda entirely: API Gateway maps the body straight onto SQS SendMessage.
export class IngestConstruct extends Construct {
  public readonly api: RestApi;
  public readonly ingestQueue: Queue;
  public readonly ingestDlq: Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.ingestDlq = new Queue(this, 'IngestDlq', {
      queueName: 'campuspulse-ingest-dlq.fifo',
      fifo: true,
      contentBasedDeduplication: true,
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
    });

    this.ingestQueue = new Queue(this, 'IngestQueue', {
      queueName: 'campuspulse-ingest-queue.fifo',
      fifo: true,
      contentBasedDeduplication: true,
      encryption: QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(30),
      deadLetterQueue: {
        queue: this.ingestDlq,
        maxReceiveCount: 5,
      },
    });

    this.api = new RestApi(this, 'CampusPulseApi', {
      restApiName: 'campuspulse-api',
      deployOptions: { stageName: 'prod' },
    });

    // Role scoped to SendMessage only, so API Gateway can never read or delete queue contents.
    const apiGatewayRole = new Role(this, 'ApiGatewaySqsRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });
    apiGatewayRole.addToPolicy(
      new PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [this.ingestQueue.queueArn],
      }),
    );

    // MessageGroupId = zoneId keeps per-zone ordering while allowing cross-zone parallelism.
    const requestTemplate = [
      'Action=SendMessage',
      '&MessageGroupId=$util.urlEncode($input.path(\'$.zoneId\'))',
      '&MessageBody=$util.urlEncode($input.body)',
    ].join('');

    const sqsIntegration = new AwsIntegration({
      service: 'sqs',
      path: `${this.ingestQueue.queueName}`,
      options: {
        credentialsRole: apiGatewayRole,
        passthroughBehavior: PassthroughBehavior.NEVER,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/x-www-form-urlencoded'",
        },
        requestTemplates: {
          'application/json': requestTemplate,
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': JSON.stringify({ message: 'accepted' }),
            },
          },
          {
            statusCode: '500',
            selectionPattern: '5\\d{2}',
            responseTemplates: {
              'application/json': JSON.stringify({ message: 'ingest failed' }),
            },
          },
        ],
      },
    });

    const methodOptions = {
      methodResponses: [{ statusCode: '200' }, { statusCode: '500' }],
    };

    const readingsResource = this.api.root.addResource('v1').addResource('readings');
    readingsResource.addMethod('POST', sqsIntegration, methodOptions);

    const fogEventsResource = this.api.root
      .getResource('v1')!
      .addResource('fog-events');
    fogEventsResource.addMethod('POST', sqsIntegration, methodOptions);
  }
}
