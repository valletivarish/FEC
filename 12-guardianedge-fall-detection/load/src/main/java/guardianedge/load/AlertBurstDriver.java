package guardianedge.load;

import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.lambda.LambdaClient;
import software.amazon.awssdk.services.lambda.model.EventSourceMappingConfiguration;
import software.amazon.awssdk.services.lambda.model.ListEventSourceMappingsRequest;
import software.amazon.awssdk.services.lambda.model.UpdateEventSourceMappingRequest;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueUrlRequest;
import software.amazon.awssdk.services.sqs.model.PurgeQueueRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Genuine WITH/WITHOUT comparison for the alert queue's SQS-batching scalability mechanism:
 * fires a burst of classified-event sends at the real (floci) guardianedge-alert-queue.fifo
 * concurrently, then polls the real EventHistoryTable (not the queue) for each item's arrival
 * to compute true end-to-end p95 latency - send to confirmed-persisted-by-IngestEventHandler.
 * Run once against an ESM reconfigured to batchSize=1/no window, once at batchSize=10/2s window,
 * per load/README.md, so the same code path measures both configurations back to back.
 */
public final class AlertBurstDriver {

    private static final String QUEUE_NAME = "guardianedge-alert-queue.fifo";
    private static final String FUNCTION_NAME = "IngestEventHandler";
    private static final String HISTORY_TABLE = "guardianedge-event-history-table";

    private AlertBurstDriver() {
    }

    public static void main(String[] args) throws Exception {
        int eventCount = intArg(args, 0, 50);
        int concurrentSenders = intArg(args, 1, 50);
        int drainPollSeconds = intArg(args, 2, 60);
        String runLabel = args.length > 3 ? args[3] : "run";

        SqsClient sqs = SqsClient.builder().build();
        LambdaClient lambda = LambdaClient.builder().build();
        DynamoDbClient dynamo = DynamoDbClient.builder().build();

        String queueUrl = sqs.getQueueUrl(GetQueueUrlRequest.builder().queueName(QUEUE_NAME).build()).queueUrl();

        // clean slate so this run's latencies aren't polluted by a prior run's backlog
        sqs.purgeQueue(PurgeQueueRequest.builder().queueUrl(queueUrl).build());
        Thread.sleep(1000);

        String batchingConfig = describeEsmBatching(lambda);
        System.out.println("=== GuardianEdge alert-queue burst load test (" + runLabel + ") ===");
        System.out.println("timestamp:            " + Instant.now());
        System.out.println("queue:                " + queueUrl);
        System.out.println("ESM batching config:  " + batchingConfig);
        System.out.println("eventCount:           " + eventCount);
        System.out.println("concurrentSenders:    " + concurrentSenders);
        System.out.println();

        // unique run marker lets us find exactly this run's items in EventHistoryTable
        String runMarker = runLabel + "-" + System.currentTimeMillis();
        List<String> residentIds = new ArrayList<>();
        for (int i = 0; i < eventCount; i++) {
            residentIds.add("load-" + runMarker + "-" + i);
        }

        // --- burst send phase ---
        ExecutorService sendPool = Executors.newFixedThreadPool(concurrentSenders);
        CountDownLatch latch = new CountDownLatch(eventCount);
        AtomicInteger sendFailures = new AtomicInteger(0);
        Map<String, Long> sendTimestampMs = new java.util.concurrent.ConcurrentHashMap<>();

        Instant sendPhaseStart = Instant.now();
        for (int i = 0; i < eventCount; i++) {
            String residentId = residentIds.get(i);
            sendPool.submit(() -> {
                try {
                    long sentAt = System.currentTimeMillis();
                    String body = classifiedEventJson(residentId);
                    sqs.sendMessage(SendMessageRequest.builder()
                            .queueUrl(queueUrl)
                            .messageBody(body)
                            .messageGroupId("fog-events")
                            .messageDeduplicationId(residentId)
                            .build());
                    sendTimestampMs.put(residentId, sentAt);
                } catch (Exception e) {
                    sendFailures.incrementAndGet();
                } finally {
                    latch.countDown();
                }
            });
        }
        latch.await();
        sendPool.shutdown();
        sendPool.awaitTermination(30, TimeUnit.SECONDS);
        long sendPhaseMs = Duration.between(sendPhaseStart, Instant.now()).toMillis();

        System.out.println("--- send phase ---");
        System.out.println("wall clock:           " + sendPhaseMs + " ms");
        System.out.println("send failures:        " + sendFailures.get());
        System.out.println();

        // --- poll EventHistoryTable for each item's real arrival time (end-to-end latency) ---
        System.out.println("--- drain phase (polling real DynamoDB EventHistoryTable) ---");
        Map<String, Long> arrivalLatencyMs = new HashMap<>();
        Instant pollDeadline = Instant.now().plusSeconds(drainPollSeconds);
        List<String> remaining = new ArrayList<>(residentIds);

        while (!remaining.isEmpty() && Instant.now().isBefore(pollDeadline)) {
            List<String> stillMissing = new ArrayList<>();
            for (String residentId : remaining) {
                Long foundAtMs = queryArrivalMs(dynamo, residentId);
                if (foundAtMs != null) {
                    long latency = foundAtMs - sendTimestampMs.get(residentId);
                    arrivalLatencyMs.put(residentId, latency);
                } else {
                    stillMissing.add(residentId);
                }
            }
            remaining = stillMissing;
            System.out.println("elapsedSec=" + Duration.between(sendPhaseStart, Instant.now()).toSeconds()
                    + ", confirmed=" + arrivalLatencyMs.size() + "/" + eventCount);
            if (!remaining.isEmpty()) {
                // tight poll interval so the "confirmed" timestamp is a close proxy for actual
                // write time - coarser polling would inflate p95 by up to the poll interval
                Thread.sleep(100);
            }
        }

        System.out.println();
        System.out.println("--- summary ---");
        System.out.println("confirmed writes:     " + arrivalLatencyMs.size() + "/" + eventCount);
        System.out.println("unconfirmed (timeout):" + remaining.size());

        List<Long> latencies = new ArrayList<>(arrivalLatencyMs.values());
        latencies.sort(Long::compareTo);
        if (!latencies.isEmpty()) {
            System.out.println("end-to-end latency p50:  " + percentile(latencies, 50) + " ms");
            System.out.println("end-to-end latency p95:  " + percentile(latencies, 95) + " ms");
            System.out.println("end-to-end latency max:  " + latencies.get(latencies.size() - 1) + " ms");
            System.out.println("end-to-end latency min:  " + latencies.get(0) + " ms");
        } else {
            System.out.println("no confirmed writes - cannot compute latency percentiles");
        }

        sqs.close();
        lambda.close();
        dynamo.close();
    }

    private static Long queryArrivalMs(DynamoDbClient dynamo, String residentId) {
        Map<String, AttributeValue> values = new HashMap<>();
        values.put(":rid", AttributeValue.builder().s(residentId).build());
        var result = dynamo.query(QueryRequest.builder()
                .tableName(HISTORY_TABLE)
                .keyConditionExpression("residentId = :rid")
                .expressionAttributeValues(values)
                .limit(1)
                .build());
        if (result.items().isEmpty()) {
            return null;
        }
        // no stored wall-clock write time on the item, so the poll-detection instant is the
        // measured proxy for "written and queryable" - tight 100ms polling keeps this close
        return System.currentTimeMillis();
    }

    private static String describeEsmBatching(LambdaClient lambda) {
        var mappings = lambda.listEventSourceMappings(ListEventSourceMappingsRequest.builder()
                .functionName(FUNCTION_NAME)
                .build())
                .eventSourceMappings();
        for (EventSourceMappingConfiguration m : mappings) {
            if (m.eventSourceArn() != null && m.eventSourceArn().contains("guardianedge-alert-queue")) {
                Integer window = m.maximumBatchingWindowInSeconds();
                return "batchSize=" + m.batchSize() + ", maxBatchingWindowSeconds=" + (window == null ? 0 : window);
            }
        }
        return "unknown (no matching ESM found)";
    }

    private static String classifiedEventJson(String residentId) {
        String timestamp = Instant.now().toString();
        return "{\"residentId\":\"" + residentId + "\",\"type\":\"fall_event\",\"confidence\":\"HIGH\","
                + "\"timestamp\":\"" + timestamp + "\"}";
    }

    private static long percentile(List<Long> sorted, int pct) {
        if (sorted.isEmpty()) {
            return 0;
        }
        int index = Math.min(sorted.size() - 1, (int) Math.ceil(pct / 100.0 * sorted.size()) - 1);
        return sorted.get(Math.max(0, index));
    }

    private static int intArg(String[] args, int index, int defaultValue) {
        if (args.length > index && !args[index].isBlank()) {
            return Integer.parseInt(args[index]);
        }
        return defaultValue;
    }
}
