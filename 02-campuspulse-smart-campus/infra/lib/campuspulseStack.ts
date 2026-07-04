import { Construct } from 'constructs';
import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { LambdaIntegration, Cors } from 'aws-cdk-lib/aws-apigateway';
import { IngestConstruct } from './ingestConstruct';
import { ProcessingConstruct } from './processingConstruct';
import { DataConstruct } from './dataConstruct';
import { DashboardHostingConstruct } from './dashboardHostingConstruct';

// Single stack keeps the demo deployable as one unit; constructs stay small and independently testable.
export class CampusPulseStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const data = new DataConstruct(this, 'Data');
    const ingest = new IngestConstruct(this, 'Ingest');
    new ProcessingConstruct(this, 'Processing', {
      ingestQueue: ingest.ingestQueue,
      readingsTable: data.readingsTable,
      alertsTable: data.alertsTable,
    });
    const dashboardHosting = new DashboardHostingConstruct(this, 'DashboardHosting');

    const commonEnv = {
      CAMPUSPULSE_READINGS_TABLE: data.readingsTable.tableName,
      CAMPUSPULSE_ALERTS_TABLE: data.alertsTable.tableName,
    };

    const zoneStatusHandler = new Function(this, 'ZoneStatusHandler', {
      functionName: 'campuspulse-zone-status',
      runtime: Runtime.NODEJS_20_X,
      handler: 'handlers/zoneStatusHandler.handler',
      // Asset root must include lib/ alongside handlers/ since handlers require sibling lib modules.
      code: Code.fromAsset('../backend/src'),
      timeout: Duration.seconds(15),
      environment: commonEnv,
    });
    data.readingsTable.grantReadData(zoneStatusHandler);
    data.alertsTable.grantReadData(zoneStatusHandler);

    const zoneHistoryHandler = new Function(this, 'ZoneHistoryHandler', {
      functionName: 'campuspulse-zone-history',
      runtime: Runtime.NODEJS_20_X,
      handler: 'handlers/zoneHistoryHandler.handler',
      code: Code.fromAsset('../backend/src'),
      timeout: Duration.seconds(15),
      environment: commonEnv,
    });
    data.readingsTable.grantReadData(zoneHistoryHandler);
    // Alerts are genuine events, not telemetry, so history must read them too (unlike hvac-duct-pressure).
    data.alertsTable.grantReadData(zoneHistoryHandler);

    const activeAlertsHandler = new Function(this, 'ActiveAlertsHandler', {
      functionName: 'campuspulse-active-alerts',
      runtime: Runtime.NODEJS_20_X,
      handler: 'handlers/activeAlertsHandler.handler',
      code: Code.fromAsset('../backend/src'),
      timeout: Duration.seconds(15),
      environment: commonEnv,
    });
    data.alertsTable.grantReadData(activeAlertsHandler);

    // CORS is on every read route since the dashboard calls the API cross-origin from CloudFront.
    const corsOptions = {
      allowOrigins: Cors.ALL_ORIGINS,
      allowMethods: Cors.ALL_METHODS,
    };

    const zonesResource = ingest.api.root.addResource('zones', {
      defaultCorsPreflightOptions: corsOptions,
    });
    const zoneResource = zonesResource.addResource('{zoneId}', {
      defaultCorsPreflightOptions: corsOptions,
    });
    zoneResource
      .addResource('status', { defaultCorsPreflightOptions: corsOptions })
      .addMethod('GET', new LambdaIntegration(zoneStatusHandler));
    zoneResource
      .addResource('history', { defaultCorsPreflightOptions: corsOptions })
      .addMethod('GET', new LambdaIntegration(zoneHistoryHandler));

    const alertsResource = ingest.api.root.addResource('alerts', {
      defaultCorsPreflightOptions: corsOptions,
    });
    alertsResource
      .addResource('active', { defaultCorsPreflightOptions: corsOptions })
      .addMethod('GET', new LambdaIntegration(activeAlertsHandler));

    new CfnOutput(this, 'ApiBaseUrl', { value: ingest.api.url });
    new CfnOutput(this, 'DashboardDistributionDomain', {
      value: dashboardHosting.distribution.distributionDomainName,
    });
    new CfnOutput(this, 'DashboardBucketName', { value: dashboardHosting.siteBucket.bucketName });
    new CfnOutput(this, 'IngestQueueUrl', { value: ingest.ingestQueue.queueUrl });
  }
}
