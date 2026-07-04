#!/usr/bin/env python3
import aws_cdk as cdk

from greengrid_stack import GreenGridStack

# Single-stack app; env kwargs omitted so CDK uses CLI/profile defaults.
app = cdk.App()
GreenGridStack(app, "GreenGridStack")

app.synth()
