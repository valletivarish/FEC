package edu.msc.floodwatch.load;

import com.fasterxml.jackson.databind.ObjectMapper;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.lambda.LambdaClient;
import software.amazon.awssdk.services.lambda.model.GetFunctionConcurrencyRequest;
import software.amazon.awssdk.services.lambda.model.GetFunctionConcurrencyResponse;
import software.amazon.awssdk.services.lambda.model.InvokeRequest;
import software.amazon.awssdk.services.lambda.model.InvokeResponse;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.GetQueueUrlRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Drives synchronous Invoke calls against ReachIntakeHandler using the same
 * SQS-batch payload shape the real event source mapping delivers, so reserved
 * concurrency throttles this traffic exactly as it would production traffic.
 * Ramps request rate ~5 -> ~60 req/s over a fixed window and records per-call
 * latency plus floci's own queue depth before/after as a secondary real signal.
 *
 * Usage: mvn -f load/pom.xml exec:java -Dexec.args="<label>"
 * Reads FLOODWATCH_INTAKE_RESERVED_CONCURRENCY (informational label only) and
 * AWS_ENDPOINT_URL / AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from env.
 */
public final class GaugeIntakeLoadDriver {

    private static final String FUNCTION_NAME = "ReachIntakeHandler";
    private static final String QUEUE_NAME = "floodwatch-gauge-intake-queue";
    private static final int[] RATE_STEPS_PER_SEC = {5, 15, 30, 45, 60};
    private static final int SECONDS_PER_STEP = 4;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private GaugeIntakeLoadDriver() {
    }

    public static void main(String[] args) throws Exception {
        String label = args.length > 0 ? args[0] : "run";
        String endpoint = System.getenv().getOrDefault("AWS_ENDPOINT_URL", "http://localhost:4566");
        String region = System.getenv().getOrDefault("AWS_REGION", "eu-west-1");

        // a stuck/crashed floci Lambda container must not hang the whole run forever;
        // bound each call so a dead container surfaces as a timed-out request instead
        LambdaClient lambdaClient = LambdaClient.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.of(region))
                .overrideConfiguration(ClientOverrideConfiguration.builder()
                        .apiCallTimeout(Duration.ofSeconds(15))
                        .apiCallAttemptTimeout(Duration.ofSeconds(15))
                        .build())
                .build();
        SqsClient sqsClient = SqsClient.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.of(region))
                .build();

        System.out.println("=== GaugeIntakeLoadDriver [" + label + "] ===");
        System.out.println("startedAt=" + Instant.now());
        System.out.println("endpoint=" + endpoint + " region=" + region);

        GetFunctionConcurrencyResponse concurrency = lambdaClient.getFunctionConcurrency(
                GetFunctionConcurrencyRequest.builder().functionName(FUNCTION_NAME).build());
        System.out.println("functionName=" + FUNCTION_NAME
                + " reservedConcurrentExecutions="
                + (concurrency.reservedConcurrentExecutions() == null ? "unset (account default)"
                        : concurrency.reservedConcurrentExecutions()));

        String queueUrl = sqsClient.getQueueUrl(GetQueueUrlRequest.builder().queueName(QUEUE_NAME).build())
                .queueUrl();
        printQueueDepth(sqsClient, queueUrl, "before");

        ConcurrentLinkedQueue<Long> latenciesMs = new ConcurrentLinkedQueue<>();
        AtomicInteger successCount = new AtomicInteger();
        AtomicInteger errorCount = new AtomicInteger();
        AtomicInteger throttleCount = new AtomicInteger();
        AtomicLong totalSent = new AtomicLong();

        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(64);
        List<CompletableFuture<Void>> inFlight = new ArrayList<>();

        Instant windowStart = Instant.now();
        for (int step = 0; step < RATE_STEPS_PER_SEC.length; step++) {
            int ratePerSec = RATE_STEPS_PER_SEC[step];
            long intervalMicros = 1_000_000L / ratePerSec;
            int callsThisStep = ratePerSec * SECONDS_PER_STEP;
            System.out.println(Instant.now() + " step=" + step + " targetRate=" + ratePerSec
                    + "req/s calls=" + callsThisStep);

            for (int i = 0; i < callsThisStep; i++) {
                long delayMicros = i * intervalMicros;
                CompletableFuture<Void> future = new CompletableFuture<>();
                inFlight.add(future);
                scheduler.schedule(() -> {
                    totalSent.incrementAndGet();
                    long start = System.nanoTime();
                    try {
                        InvokeRequest req = InvokeRequest.builder()
                                .functionName(FUNCTION_NAME)
                                .payload(SdkBytes.fromUtf8String(sqsBatchPayload()))
                                .build();
                        InvokeResponse resp = lambdaClient.invoke(req);
                        long elapsedMs = (System.nanoTime() - start) / 1_000_000;
                        latenciesMs.add(elapsedMs);
                        if (resp.functionError() != null) {
                            errorCount.incrementAndGet();
                        } else {
                            successCount.incrementAndGet();
                        }
                    } catch (Exception e) {
                        errorCount.incrementAndGet();
                        String name = e.getClass().getSimpleName();
                        if (name.contains("TooManyRequests") || name.contains("Throttl")) {
                            throttleCount.incrementAndGet();
                        }
                        latenciesMs.add((System.nanoTime() - start) / 1_000_000);
                    } finally {
                        future.complete(null);
                    }
                }, delayMicros, TimeUnit.MICROSECONDS);
            }
            Thread.sleep(SECONDS_PER_STEP * 1000L);
        }

        try {
            CompletableFuture.allOf(inFlight.toArray(new CompletableFuture[0])).get(90, TimeUnit.SECONDS);
        } catch (java.util.concurrent.TimeoutException e) {
            System.out.println("WARNING: " + (inFlight.size() - latenciesMs.size())
                    + " calls never returned within the join deadline (likely a wedged floci"
                    + " container); reporting stats over the calls that did complete.");
        }
        scheduler.shutdownNow();
        Duration totalWindow = Duration.between(windowStart, Instant.now());

        printQueueDepth(sqsClient, queueUrl, "after");

        List<Long> sorted = new ArrayList<>(latenciesMs);
        sorted.sort(Long::compareTo);
        System.out.println();
        System.out.println("=== RESULTS [" + label + "] ===");
        System.out.println("finishedAt=" + Instant.now());
        System.out.println("wallClockSeconds=" + totalWindow.toSeconds());
        System.out.println("totalInvocationsSent=" + totalSent.get());
        System.out.println("success=" + successCount.get() + " functionErrors=" + errorCount.get()
                + " throttled=" + throttleCount.get());
        System.out.println("p50Ms=" + percentile(sorted, 50));
        System.out.println("p95Ms=" + percentile(sorted, 95));
        System.out.println("p99Ms=" + percentile(sorted, 99));
        System.out.println("maxMs=" + (sorted.isEmpty() ? -1 : sorted.get(sorted.size() - 1)));
        System.out.println("minMs=" + (sorted.isEmpty() ? -1 : sorted.get(0)));
        System.out.println("meanMs=" + mean(sorted));

        lambdaClient.close();
        sqsClient.close();
    }

    private static void printQueueDepth(SqsClient sqsClient, String queueUrl, String when) {
        Map<QueueAttributeName, String> attrs = sqsClient.getQueueAttributes(GetQueueAttributesRequest.builder()
                .queueUrl(queueUrl)
                .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES,
                        QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES_NOT_VISIBLE)
                .build()).attributes();
        System.out.println("queueDepth[" + when + "]: visible="
                + attrs.get(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
                + " inFlight=" + attrs.get(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES_NOT_VISIBLE));
    }

    private static long percentile(List<Long> sorted, int pct) {
        if (sorted.isEmpty()) {
            return -1;
        }
        int index = (int) Math.ceil(pct / 100.0 * sorted.size()) - 1;
        return sorted.get(Math.max(0, Math.min(index, sorted.size() - 1)));
    }

    private static double mean(List<Long> values) {
        return values.isEmpty() ? -1 : values.stream().mapToLong(Long::longValue).average().orElse(-1);
    }

    /** One SQS-batch record carrying a realistic hydro_event body, matching ReachIntakeHandler's real input shape. */
    private static String sqsBatchPayload() throws Exception {
        String timestamp = Instant.now().toString();
        String body = MAPPER.writeValueAsString(Map.of(
                "type", "hydro_event",
                "reachId", "reach-load-test",
                "stage", "GREEN",
                "riverLevel", 1.8,
                "rateOfRise", 0.02,
                "soilSaturationAmplified", false,
                "crossReachEscalated", false,
                "timestamp", timestamp));
        Map<String, Object> record = Map.of("body", body);
        Map<String, Object> event = Map.of("Records", Arrays.asList(record));
        return MAPPER.writeValueAsString(event);
    }
}
