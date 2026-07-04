import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource, DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';

export interface ProcessingConstructProps {
  ingestQueue: Queue;
  readingsTable: Table;
  alertsTable: Table;
}

// Batch size 10 balances DynamoDB write throughput against per-invocation Lambda overhead.
export class ProcessingConstruct extends Construct {
  public readonly readingWriterHandler: Function;
  public readonly alertDispatcherHandler: Function;

  constructor(scope: Construct, id: string, props: ProcessingConstructProps) {
    super(scope, id);

    this.readingWriterHandler = new Function(this, 'ReadingWriterHandler', {
      functionName: 'campuspulse-reading-writer',
      runtime: Runtime.NODEJS_20_X,
      handler: 'handlers/readingWriterHandler.handler',
      // Asset root must include lib/ alongside handlers/ since handlers require sibling lib modules.
      code: Code.fromAsset('../backend/src'),
      timeout: Duration.seconds(30),
      environment: {
        CAMPUSPULSE_READINGS_TABLE: props.readingsTable.tableName,
        CAMPUSPULSE_ALERTS_TABLE: props.alertsTable.tableName,
      },
    });
    this.readingWriterHandler.addEventSource(
      new SqsEventSource(props.ingestQueue, { batchSize: 10 }),
    );
    props.readingsTable.grantWriteData(this.readingWriterHandler);
    props.alertsTable.grantWriteData(this.readingWriterHandler);

    // Stream-driven dispatcher reacts only to newly written alerts, not reading writes.
    this.alertDispatcherHandler = new Function(this, 'AlertDispatcherHandler', {
      functionName: 'campuspulse-alert-dispatcher',
      runtime: Runtime.NODEJS_20_X,
      handler: 'handlers/alertDispatcherHandler.handler',
      code: Code.fromAsset('../backend/src'),
      timeout: Duration.seconds(30),
      environment: {
        CAMPUSPULSE_ALERTS_TABLE: props.alertsTable.tableName,
      },
    });
    this.alertDispatcherHandler.addEventSource(
      new DynamoEventSource(props.alertsTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
      }),
    );
  }
}
