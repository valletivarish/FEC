#!/usr/bin/env node
// floci-only entrypoint: real AWS deploy goes through bin/officeiq.ts's default synthesizer.
// floci's STS AssumeRole for the bootstrap file/image/deploy roles doesn't hand back usable
// credentials, so this uses CliCredentialsStackSynthesizer to publish/deploy with the CLI's
// own static test credentials directly instead of assuming those roles - local dev/load-test only.
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OfficeIqStack } from '../lib/officeiq-stack';

const app = new cdk.App();
new OfficeIqStack(app, 'OfficeIqStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  synthesizer: new cdk.CliCredentialsStackSynthesizer(),
  // pre-built and docker-pushed straight to floci's ECR-compatible registry (see load/results.md)
  workerImageEcrRepositoryName: process.env.OFFICEIQ_LOCAL_WORKER_ECR_REPO,
  workerImageTag: process.env.OFFICEIQ_LOCAL_WORKER_IMAGE_TAG,
  extraWorkerEnvironment: {
    AWS_REGION: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
    // worker containers land on floci's own "fec_default" docker network with a real IP, but the
    // "floci" DNS alias doesn't resolve from inside them (floci registers network membership
    // without a working embedded DNS entry) - the docker-network IP works, so use that directly
    AWS_ENDPOINT_URL: `http://${process.env.OFFICEIQ_LOCAL_FLOCI_NETWORK_IP ?? '172.20.0.2'}:4566`,
    // floci's Fargate emulation doesn't serve the ECS task-role credentials endpoint the container
    // SDK expects, so local runs fall back to static test creds instead of the real IAM task role
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
  },
});
