package binsight.infra;

import software.amazon.awscdk.App;

/**
 * Entry point invoked by the CDK CLI (via cdk.json's "mvn exec:java" app command).
 */
public final class BinSightApp {

    private BinSightApp() {
    }

    public static void main(final String[] args) {
        App app = new App();
        // overridable only so a corrupted local-emulator stack state can be recovered without
        // fighting CloudFormation's tracking of already-vanished resources; unset -> "BinSightStack"
        String stackName = System.getenv().getOrDefault("BINSIGHT_STACK_NAME", "BinSightStack");
        new BinSightStack(app, stackName);
        app.synth();
    }
}
