#!/usr/bin/env python3
import aws_cdk as cdk

from aerosense_stack import AeroSenseStack

# Single-stack app; env kwargs omitted so CDK uses CLI/profile defaults.
app = cdk.App()
AeroSenseStack(app, "AeroSenseStack")

app.synth()
