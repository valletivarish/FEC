package edu.msc.chainfrost.load;

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.kinesis.KinesisClient;
import software.amazon.awssdk.services.kinesis.model.CreateStreamRequest;
import software.amazon.awssdk.services.kinesis.model.ListStreamsRequest;
import software.amazon.awssdk.services.kinesis.model.ResourceInUseException;

import java.net.URI;

/**
 * Stands up the chainfrost-telemetry-stream directly against floci: the CDK bootstrap
 * flow doesn't clear floci's IAM emulation (see README), so this mirrors what
 * SensorToFogToBackendIT already does for DynamoDB - provision via SDK, matching the
 * shard count the real ChainFrostStack declares.
 */
public final class ProvisionStream {

    private static final String STREAM_NAME = "chainfrost-telemetry-stream";
    private static final int SHARD_COUNT = 4;

    private ProvisionStream() {
    }

    public static void main(String[] args) throws InterruptedException {
        String endpoint = System.getenv().getOrDefault("AWS_ENDPOINT_URL", "http://localhost:4566");
        KinesisClient kinesisClient = KinesisClient.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build();

        try {
            kinesisClient.createStream(CreateStreamRequest.builder()
                    .streamName(STREAM_NAME)
                    .shardCount(SHARD_COUNT)
                    .build());
            System.out.println("create-stream requested: " + STREAM_NAME + " with " + SHARD_COUNT + " shards");
        } catch (ResourceInUseException alreadyExists) {
            System.out.println("stream already exists: " + STREAM_NAME);
        }

        waitUntilActive(kinesisClient);
    }

    /**
     * Polls listStreams (not describeStreamSummary) - floci emits StreamCreationTimestamp in
     * scientific notation which the SDK's strict date parser on that response rejects.
     */
    private static void waitUntilActive(KinesisClient kinesisClient) throws InterruptedException {
        for (int attempt = 0; attempt < 30; attempt++) {
            boolean present = kinesisClient.listStreams(ListStreamsRequest.builder().build())
                    .streamNames().contains(STREAM_NAME);
            if (present) {
                System.out.println("stream present in listStreams: " + STREAM_NAME);
                return;
            }
            System.out.println("stream not visible yet, retrying...");
            Thread.sleep(1000);
        }
        throw new IllegalStateException("stream did not become visible in time");
    }
}
