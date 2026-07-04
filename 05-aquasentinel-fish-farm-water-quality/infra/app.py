#!/usr/bin/env python3
import os

import aws_cdk as cdk

from aquasentinel_stack import AquaSentinelStack

# Single-stack app; env kwargs omitted so CDK uses CLI/profile defaults.
# Override lets a stuck floci DELETE_FAILED stack be bypassed without renaming it for real AWS.
app = cdk.App()
stack_name = os.environ.get("AQUASENTINEL_STACK_NAME", "AquaSentinelStack")
AquaSentinelStack(app, stack_name)

app.synth()
