#!/usr/bin/env python3
import aws_cdk as cdk

from guard_stack import GuardStack

# Single-stack app; env kwargs omitted so CDK uses CLI/profile defaults.
app = cdk.App()
GuardStack(app, "GuardStack")

app.synth()
