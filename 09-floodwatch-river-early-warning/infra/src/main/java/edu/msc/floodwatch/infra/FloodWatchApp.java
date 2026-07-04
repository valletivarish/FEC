package edu.msc.floodwatch.infra;

import software.amazon.awscdk.App;

/**
 * Entry point invoked by the CDK CLI (via cdk.json's "mvn exec:java" app command).
 */
public final class FloodWatchApp {

    private FloodWatchApp() {
    }

    public static void main(final String[] args) {
        App app = new App();
        // stack name overridable only to route around a stuck DELETE_FAILED stack in the
        // shared local emulator during a live demo session; unset in normal use
        String stackName = System.getenv().getOrDefault("FLOODWATCH_STACK_NAME", "FloodWatchStack");
        new FloodWatchStack(app, stackName);
        app.synth();
    }
}
