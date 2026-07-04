package binsight.load;

import software.amazon.awssdk.services.lambda.LambdaClient;
import software.amazon.awssdk.services.lambda.model.GetFunctionConcurrencyRequest;
import software.amazon.awssdk.services.lambda.model.GetFunctionConcurrencyResponse;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.GetQueueUrlRequest;
import software.amazon.awssdk.services.sqs.model.PurgeQueueRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Genuine burst-load driver for the fire-risk pipeline: fires a configurable number of
 * fire_risk_alert-shaped messages at the real (floci) SQS queue concurrently - the same
 * queue IngestRelayHandler's FireRiskRelayHandler deployment relays HTTP POSTs onto - then
 * polls GetQueueAttributes for real backlog/age numbers while FireRiskIngestHandler drains
 * it, so the same run can be repeated against two deploys (default vs reserved concurrency)
 * to compare backpressure absorption. See load/README.md for how to run this twice.
 */
public final class FireRiskBurstDriver {

    private static final String QUEUE_NAME = "binsight-fire-risk-queue";
    private static final String FUNCTION_NAME = "FireRiskIngestHandler";

    private FireRiskBurstDriver() {
    }

    public static void main(String[] args) throws Exception {
        int messageCount = intArg(args, 0, 300);
        int concurrentSenders = intArg(args, 1, 40);
        int drainPollSeconds = intArg(args, 2, 90);

        SqsClient sqs = SqsClient.builder().build();
        LambdaClient lambda = LambdaClient.builder().build();

        String queueUrl = sqs.getQueueUrl(GetQueueUrlRequest.builder().queueName(QUEUE_NAME).build()).queueUrl();

        // clean slate so backlog/age numbers reflect only this run's burst
        sqs.purgeQueue(PurgeQueueRequest.builder().queueUrl(queueUrl).build());
        Thread.sleep(1000);

        String reservedConcurrency = describeReservedConcurrency(lambda);
        System.out.println("=== BinSight fire-risk burst load test ===");
        System.out.println("timestamp:            " + Instant.now());
        System.out.println("queue:                " + queueUrl);
        System.out.println("FireRiskIngestHandler reserved concurrency: " + reservedConcurrency);
        System.out.println("messageCount:         " + messageCount);
        System.out.println("concurrentSenders:    " + concurrentSenders);
        System.out.println();

        // --- burst send phase: fire messageCount sends across concurrentSenders threads ---
        ExecutorService sendPool = Executors.newFixedThreadPool(concurrentSenders);
        CountDownLatch latch = new CountDownLatch(messageCount);
        AtomicLong totalSendLatencyMs = new AtomicLong(0);
        AtomicInteger sendFailures = new AtomicInteger(0);
        List<Long> sendLatencies = java.util.Collections.synchronizedList(new ArrayList<>());

        Instant sendPhaseStart = Instant.now();
        for (int i = 0; i < messageCount; i++) {
            int binIndex = i % 20;
            sendPool.submit(() -> {
                long start = System.nanoTime();
                try {
                    String body = fireRiskAlertJson("bin-load-" + binIndex, "CRITICAL");
                    sqs.sendMessage(SendMessageRequest.builder().queueUrl(queueUrl).messageBody(body).build());
                    long elapsedMs = (System.nanoTime() - start) / 1_000_000;
                    totalSendLatencyMs.addAndGet(elapsedMs);
                    sendLatencies.add(elapsedMs);
                } catch (Exception e) {
                    sendFailures.incrementAndGet();
                } finally {
                    latch.countDown();
                }
            });
        }
        latch.await();
        sendPool.shutdown();
        Instant sendPhaseEnd = Instant.now();

        long sendPhaseMs = Duration.between(sendPhaseStart, sendPhaseEnd).toMillis();
        sendLatencies.sort(Long::compareTo);
        long p50 = percentile(sendLatencies, 50);
        long p95 = percentile(sendLatencies, 95);
        long maxLatency = sendLatencies.isEmpty() ? 0 : sendLatencies.get(sendLatencies.size() - 1);

        System.out.println("--- send phase ---");
        System.out.println("wall clock:           " + sendPhaseMs + " ms");
        System.out.println("send failures:        " + sendFailures.get());
        System.out.println("send latency p50:     " + p50 + " ms");
        System.out.println("send latency p95:     " + p95 + " ms");
        System.out.println("send latency max:     " + maxLatency + " ms");
        System.out.println("effective send rate:  " + String.format("%.1f", messageCount * 1000.0 / sendPhaseMs) + " msg/s");
        System.out.println();

        // --- drain poll phase: sample real queue depth + ApproximateAgeOfOldestMessage every 2s ---
        System.out.println("--- drain phase (polling real SQS GetQueueAttributes) ---");
        System.out.println("elapsedSec, approxVisible, approxNotVisible, approxAgeOfOldestSec");

        int maxBacklog = 0;
        int maxAgeSeconds = 0;
        Instant drainStart = Instant.now();
        Instant lastNonZero = drainStart;
        for (int elapsed = 0; elapsed <= drainPollSeconds; elapsed += 2) {
            // ALL rather than the enum list: this SDK's QueueAttributeName enum predates
            // ApproximateAgeOfOldestMessage, but the attribute is present on the wire regardless.
            Map<String, String> attrs = sqs.getQueueAttributes(GetQueueAttributesRequest.builder()
                    .queueUrl(queueUrl)
                    .attributeNames(QueueAttributeName.ALL)
                    .build())
                    .attributesAsStrings();

            int visible = Integer.parseInt(attrs.getOrDefault("ApproximateNumberOfMessages", "0"));
            int notVisible = Integer.parseInt(attrs.getOrDefault("ApproximateNumberOfMessagesNotVisible", "0"));
            int ageSeconds = Integer.parseInt(attrs.getOrDefault("ApproximateAgeOfOldestMessage", "0"));

            maxBacklog = Math.max(maxBacklog, visible + notVisible);
            maxAgeSeconds = Math.max(maxAgeSeconds, ageSeconds);
            System.out.println(elapsed + ", " + visible + ", " + notVisible + ", " + ageSeconds);

            if (visible + notVisible > 0) {
                lastNonZero = Instant.now();
            } else if (elapsed > 0) {
                System.out.println("queue drained (0 visible, 0 in-flight) at elapsedSec=" + elapsed);
                break;
            }

            Thread.sleep(2000);
        }
        long drainedAfterSec = Duration.between(drainStart, lastNonZero).toSeconds() + 2;

        System.out.println();
        System.out.println("--- summary ---");
        System.out.println("max observed backlog (visible+inflight): " + maxBacklog);
        System.out.println("max observed ApproximateAgeOfOldestMessage (sec): " + maxAgeSeconds);
        System.out.println("approx time until queue drained to zero (sec): " + drainedAfterSec);

        sqs.close();
        lambda.close();
    }

    private static String describeReservedConcurrency(LambdaClient lambda) {
        try {
            GetFunctionConcurrencyResponse response = lambda.getFunctionConcurrency(
                    GetFunctionConcurrencyRequest.builder().functionName(FUNCTION_NAME).build());
            Integer reserved = response.reservedConcurrentExecutions();
            return reserved == null ? "UNRESERVED (default account concurrency pool)" : String.valueOf(reserved);
        } catch (Exception e) {
            return "unknown (" + e.getMessage() + ")";
        }
    }

    private static String fireRiskAlertJson(String binId, String riskStatus) {
        String timestamp = Instant.now().toString();
        return "{\"type\":\"fire_risk_alert\",\"binId\":\"" + binId + "\",\"riskStatus\":\"" + riskStatus
                + "\",\"methanePpm\":5000,\"internalTempC\":70,\"tilt\":50,\"timestamp\":\"" + timestamp + "\"}";
    }

    private static long percentile(List<Long> sorted, int pct) {
        if (sorted.isEmpty()) {
            return 0;
        }
        int index = Math.min(sorted.size() - 1, (int) Math.ceil(pct / 100.0 * sorted.size()) - 1);
        return sorted.get(Math.max(0, index));
    }

    private static int intArg(String[] args, int index, int defaultValue) {
        if (args.length > index) {
            return Integer.parseInt(args[index]);
        }
        return defaultValue;
    }
}
