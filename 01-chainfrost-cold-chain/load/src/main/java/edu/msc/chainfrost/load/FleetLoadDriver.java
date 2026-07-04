package edu.msc.chainfrost.load;

import edu.msc.chainfrost.fog.common.FogEvent;
import edu.msc.chainfrost.fog.common.KinesisDispatchClient;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.kinesis.KinesisClient;
import software.amazon.awssdk.services.kinesis.model.GetShardIteratorRequest;
import software.amazon.awssdk.services.kinesis.model.Shard;
import software.amazon.awssdk.services.kinesis.model.ShardIteratorType;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Ramps the number of concurrent simulated trucks publishing readings through the real
 * fog-node dispatch path (KinesisDispatchClient -> chainfrost-telemetry-stream, 4 shards)
 * and times PutRecord latency at each load level, plus reads back each shard's
 * IteratorAgeMilliseconds so the low-vs-high comparison uses floci's own numbers, not
 * client-side estimates alone.
 *
 * Usage: LOAD_LEVELS=5,40 READINGS_PER_TRUCK=5 mvn -q -pl load exec:java \
 *   -Dexec.mainClass=edu.msc.chainfrost.load.FleetLoadDriver
 */
public final class FleetLoadDriver {

    private static final String STREAM_NAME = "chainfrost-telemetry-stream";

    private FleetLoadDriver() {
    }

    public static void main(String[] args) throws Exception {
        String endpoint = System.getenv().getOrDefault("AWS_ENDPOINT_URL", "http://localhost:4566");
        int[] loadLevels = parseLevels(System.getenv().getOrDefault("LOAD_LEVELS", "5,40"));
        int readingsPerTruck = Integer.parseInt(System.getenv().getOrDefault("READINGS_PER_TRUCK", "5"));

        KinesisClient rawClient = KinesisClient.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build();

        System.out.println("=== ChainFrost Kinesis fan-in load test ===");
        System.out.println("stream=" + STREAM_NAME + " endpoint=" + endpoint
                + " loadLevels=" + java.util.Arrays.toString(loadLevels) + " readingsPerTruck=" + readingsPerTruck);
        System.out.println("startedAt=" + Instant.now());

        for (int truckCount : loadLevels) {
            runLevel(rawClient, endpoint, truckCount, readingsPerTruck);
        }

        System.out.println("finishedAt=" + Instant.now());
        rawClient.close();
    }

    private static void runLevel(KinesisClient rawClient, String endpoint, int truckCount, int readingsPerTruck)
            throws Exception {
        KinesisClient dispatchBackingClient = KinesisClient.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build();
        KinesisDispatchClient dispatchClient = new KinesisDispatchClient(dispatchBackingClient);

        int totalEvents = truckCount * readingsPerTruck;
        ExecutorService pool = Executors.newFixedThreadPool(Math.min(truckCount, 64));
        CountDownLatch latch = new CountDownLatch(totalEvents);
        List<Long> latenciesMillis = new ArrayList<>(totalEvents);
        Object latencyLock = new Object();
        LongAdder errors = new LongAdder();
        AtomicLong maxLatency = new AtomicLong(0);

        System.out.println();
        System.out.println("--- level: " + truckCount + " concurrent trucks (" + totalEvents + " events total) ---");
        long levelStart = System.nanoTime();
        Instant wallStart = Instant.now();

        for (int truck = 0; truck < truckCount; truck++) {
            String truckId = "LOAD-TRUCK-" + truck;
            for (int reading = 0; reading < readingsPerTruck; reading++) {
                pool.submit(() -> {
                    long recordStart = System.nanoTime();
                    try {
                        FogEvent event = new FogEvent(
                                truckId,
                                "SHIPMENT-" + truckId,
                                "EXCURSION_BREACH",
                                "HIGH",
                                Map.of("zone1TempC", -12.4, "setpointC", -18.0, "truckCount", truckCount),
                                Instant.now());
                        dispatchClient.dispatch(event);
                        long elapsedMillis = (System.nanoTime() - recordStart) / 1_000_000;
                        synchronized (latencyLock) {
                            latenciesMillis.add(elapsedMillis);
                        }
                        maxLatency.updateAndGet(current -> Math.max(current, elapsedMillis));
                    } catch (RuntimeException e) {
                        errors.increment();
                    } finally {
                        latch.countDown();
                    }
                });
            }
        }

        latch.await(2, TimeUnit.MINUTES);
        long levelElapsedMillis = (System.nanoTime() - levelStart) / 1_000_000;
        pool.shutdown();
        dispatchClient.shutdown();

        List<Long> sorted = new ArrayList<>(latenciesMillis);
        sorted.sort(Long::compareTo);
        double meanLatency = sorted.stream().mapToLong(Long::longValue).average().orElse(0);
        long p50 = percentile(sorted, 50);
        long p95 = percentile(sorted, 95);
        long p99 = percentile(sorted, 99);
        double throughput = sorted.isEmpty() ? 0 : (sorted.size() * 1000.0 / levelElapsedMillis);

        System.out.println("wallStart=" + wallStart);
        System.out.println("events dispatched=" + sorted.size() + " errors=" + errors.sum());
        System.out.println("wallClockMillisForLevel=" + levelElapsedMillis);
        System.out.println("throughputEventsPerSec=" + String.format("%.2f", throughput));
        System.out.println("putRecordLatencyMillis: mean=" + String.format("%.2f", meanLatency)
                + " p50=" + p50 + " p95=" + p95 + " p99=" + p99 + " max=" + maxLatency.get());

        // let floci's stream-level metrics settle, then pull real per-shard IteratorAge/backlog
        Thread.sleep(500);
        reportShardState(rawClient, endpoint);
    }

    private static final Pattern RECORD_COUNT_PATTERN = Pattern.compile("\"SequenceNumber\"");
    private static final Pattern MILLIS_BEHIND_PATTERN = Pattern.compile("\"MillisBehindLatest\":(\\d+)");

    /**
     * Skips describeStreamSummary/getRecords over the SDK - floci emits timestamp fields
     * (StreamCreationTimestamp, ApproximateArrivalTimestamp) in a decimal-seconds form the
     * SDK's strict response parser rejects. Raw HTTP against the same JSON protocol floci
     * exposes sidesteps that parser without touching the dispatch path under test.
     */
    private static void reportShardState(KinesisClient rawClient, String endpoint) throws Exception {
        List<Shard> shards = rawClient.listShards(builder -> builder.streamName(STREAM_NAME)).shards();
        System.out.println("openShardCount=" + shards.size());

        HttpClient httpClient = HttpClient.newHttpClient();
        for (Shard shard : shards) {
            String iterator = rawClient.getShardIterator(GetShardIteratorRequest.builder()
                    .streamName(STREAM_NAME)
                    .shardId(shard.shardId())
                    .shardIteratorType(ShardIteratorType.TRIM_HORIZON)
                    .build()).shardIterator();

            String body = "{\"ShardIterator\":\"" + iterator + "\",\"Limit\":1000}";
            HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint))
                    .header("X-Amz-Target", "Kinesis_20131202.GetRecords")
                    .header("Content-Type", "application/x-amz-json-1.1")
                    .header("Authorization",
                            "AWS4-HMAC-SHA256 Credential=test/20260101/us-east-1/kinesis/aws4_request, "
                                    + "SignedHeaders=host, Signature=test")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            int recordCount = 0;
            Matcher recordMatcher = RECORD_COUNT_PATTERN.matcher(response.body());
            while (recordMatcher.find()) {
                recordCount++;
            }
            Matcher millisMatcher = MILLIS_BEHIND_PATTERN.matcher(response.body());
            String millisBehind = millisMatcher.find() ? millisMatcher.group(1) : "unknown";

            System.out.println("  shard=" + shard.shardId()
                    + " recordsInShard=" + recordCount
                    + " millisBehindLatest=" + millisBehind);
        }
    }

    private static long percentile(List<Long> sortedLatencies, int percentile) {
        if (sortedLatencies.isEmpty()) {
            return 0;
        }
        int index = (int) Math.ceil(percentile / 100.0 * sortedLatencies.size()) - 1;
        index = Math.max(0, Math.min(index, sortedLatencies.size() - 1));
        return sortedLatencies.get(index);
    }

    private static int[] parseLevels(String csv) {
        String[] parts = csv.split(",");
        int[] levels = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            levels[i] = Integer.parseInt(parts[i].trim());
        }
        return levels;
    }
}
