#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OfficeIqStack } from '../lib/officeiq-stack';

const app = new cdk.App();
new OfficeIqStack(app, 'OfficeIqStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
