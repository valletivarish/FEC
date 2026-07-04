#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { CampusPulseStack } from '../lib/campuspulseStack';

const app = new App();
new CampusPulseStack(app, 'CampusPulseStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
