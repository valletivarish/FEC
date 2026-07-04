package edu.msc.chainfrost.infra;

import software.amazon.awscdk.App;

/**
 * Entry point invoked by the CDK CLI (via cdk.json's "mvn exec:java" app command).
 */
public final class ChainFrostApp {

    private ChainFrostApp() {
    }

    public static void main(final String[] args) {
        App app = new App();
        new ChainFrostStack(app, "ChainFrostStack");
        app.synth();
    }
}
