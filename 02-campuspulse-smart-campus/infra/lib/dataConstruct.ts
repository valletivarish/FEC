import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';

// Both tables share the zoneId partition key so every read path filters by zone first.
export class DataConstruct extends Construct {
  public readonly readingsTable: Table;
  public readonly alertsTable: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.readingsTable = new Table(this, 'ReadingsTable', {
      tableName: 'CampusPulseReadings',
      partitionKey: { name: 'zoneId', type: AttributeType.STRING },
      sortKey: { name: 'sensorTimestamp', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Stream feeds the alert dispatcher Lambda so new alerts trigger downstream notification logic.
    this.alertsTable = new Table(this, 'AlertsTable', {
      tableName: 'CampusPulseAlerts',
      partitionKey: { name: 'zoneId', type: AttributeType.STRING },
      sortKey: { name: 'alertTimestamp', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      stream: StreamViewType.NEW_IMAGE,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
