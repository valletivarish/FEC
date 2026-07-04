#!/usr/bin/env python3
import aws_cdk as cdk

from harborpulse_stack import HarborPulseStack

app = cdk.App()
HarborPulseStack(app, "HarborPulseStack")

app.synth()
