#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ParkFogStack } from '../lib/parkfog-stack';

const app = new cdk.App();
// stack name overridable via context: floci's CFN emulator can leave a stack name
// permanently DELETE_FAILED after a transient failure with no way to force-delete it
const stackName = app.node.tryGetContext('stackName') || 'ParkFogStack';
new ParkFogStack(app, stackName, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
