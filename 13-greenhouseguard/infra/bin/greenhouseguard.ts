#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GreenhouseGuardStack } from '../lib/greenhouseguard-stack';

const app = new cdk.App();
new GreenhouseGuardStack(app, 'GreenhouseGuardStack', {});
