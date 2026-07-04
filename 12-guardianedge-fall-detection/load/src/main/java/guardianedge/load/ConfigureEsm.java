package guardianedge.load;

import software.amazon.awssdk.services.lambda.LambdaClient;
import software.amazon.awssdk.services.lambda.model.EventSourceMappingConfiguration;
import software.amazon.awssdk.services.lambda.model.ListEventSourceMappingsRequest;
import software.amazon.awssdk.services.lambda.model.UpdateEventSourceMappingRequest;

/**
 * Flips the IngestEventHandler SQS event-source-mapping's batchSize so the same deployed stack
 * can be measured WITHOUT and WITH batching without a redeploy. The windowSeconds argument is
 * accepted for completeness but has no effect against the real alert queue: it's FIFO, and AWS
 * Lambda does not support a batching window on FIFO event-source-mappings - floci silently
 * accepts the value without applying it, real AWS would reject the deploy outright. Usage:
 * ConfigureEsm &lt;batchSize&gt; &lt;windowSecondsIgnoredForFifo&gt;
 */
public final class ConfigureEsm {

    private static final String FUNCTION_NAME = "IngestEventHandler";

    private ConfigureEsm() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: ConfigureEsm <batchSize> <maxBatchingWindowSeconds>");
            System.exit(1);
        }
        int batchSize = Integer.parseInt(args[0]);
        int windowSeconds = Integer.parseInt(args[1]);

        LambdaClient lambda = LambdaClient.builder().build();
        var mappings = lambda.listEventSourceMappings(ListEventSourceMappingsRequest.builder()
                .functionName(FUNCTION_NAME)
                .build())
                .eventSourceMappings();

        EventSourceMappingConfiguration target = null;
        for (EventSourceMappingConfiguration m : mappings) {
            if (m.eventSourceArn() != null && m.eventSourceArn().contains("guardianedge-alert-queue")) {
                target = m;
                break;
            }
        }
        if (target == null) {
            System.err.println("no SQS event-source-mapping found for " + FUNCTION_NAME);
            System.exit(1);
            return;
        }
        String uuid = target.uuid();

        var updateBuilder = UpdateEventSourceMappingRequest.builder()
                .uuid(uuid)
                .batchSize(batchSize);
        if (windowSeconds > 0) {
            updateBuilder.maximumBatchingWindowInSeconds(windowSeconds);
        }
        lambda.updateEventSourceMapping(updateBuilder.build());

        // wait for the mapping to leave the transitional "Updating" state before the caller proceeds
        for (int i = 0; i < 30; i++) {
            var refreshed = lambda.listEventSourceMappings(ListEventSourceMappingsRequest.builder()
                    .functionName(FUNCTION_NAME)
                    .build())
                    .eventSourceMappings();
            String state = refreshed.stream()
                    .filter(m -> m.uuid().equals(uuid))
                    .findFirst()
                    .map(EventSourceMappingConfiguration::state)
                    .orElse("Unknown");
            if ("Enabled".equals(state)) {
                break;
            }
            Thread.sleep(1000);
        }

        System.out.println("ESM " + uuid + " reconfigured: batchSize=" + batchSize
                + ", maxBatchingWindowSeconds=" + windowSeconds);
        lambda.close();
    }
}
