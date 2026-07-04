#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GridPulseStack } from '../lib/gridpulse-stack';

const app = new cdk.App();
// override lets a stuck local emulator stack be replaced without reusing its corrupted name
new GridPulseStack(app, process.env.GRIDPULSE_STACK_NAME || 'GridPulseStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
