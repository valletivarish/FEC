#!/usr/bin/env node
import { App, Stack, CfnOutput } from 'aws-cdk-lib';
import { IngestConstruct } from '../lib/ingestConstruct';

// Deploys only the real IngestConstruct against floci so the integration test can hit the
// actual API-Gateway-to-SQS route without dragging in CloudFront/S3 custom resources that
// need real internet egress and are unrelated to the ingest path being proven.
const app = new App();
const stack = new Stack(app, 'CampusPulseIngestOnlyTestStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
const ingest = new IngestConstruct(stack, 'IngestTest');
new CfnOutput(stack, 'ApiBaseUrl', { value: ingest.api.url });
new CfnOutput(stack, 'IngestQueueUrl', { value: ingest.ingestQueue.queueUrl });
