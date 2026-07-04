package ie.nci.flowforge.infra;

import software.amazon.awscdk.App;

/**
 * Entry point invoked by the CDK CLI (via cdk.json's "mvn exec:java" app command).
 */
public final class FlowForgeApp {

    private FlowForgeApp() {
    }

    public static void main(final String[] args) {
        App app = new App();
        new FlowForgeStack(app, "FlowForgeStack");
        app.synth();
    }
}
