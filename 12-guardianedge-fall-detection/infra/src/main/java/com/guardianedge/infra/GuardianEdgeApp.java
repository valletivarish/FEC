package com.guardianedge.infra;

import software.amazon.awscdk.App;
import software.amazon.awscdk.StackProps;

/**
 * Entry point invoked by the CDK CLI (via cdk.json's "mvn exec:java" app command).
 */
public final class GuardianEdgeApp {

    private GuardianEdgeApp() {
    }

    public static void main(final String[] args) {
        App app = new App();
        // CloudFormation stack name is overridable via GUARDIANEDGE_STACK_NAME (defaults to
        // GuardianEdgeStack) so a corrupted local-emulator stack record can be replaced without
        // touching resource logic; deploy behaviour and template are otherwise unchanged.
        String stackName = System.getenv().getOrDefault("GUARDIANEDGE_STACK_NAME", "GuardianEdgeStack");
        new GuardianEdgeStack(app, "GuardianEdgeStack", StackProps.builder().stackName(stackName).build());
        app.synth();
    }
}
