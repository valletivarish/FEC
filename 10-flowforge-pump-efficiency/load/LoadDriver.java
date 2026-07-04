import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Fires synthetic /insights POSTs at the deployed FlowForgeStack API at a target
 * events/min rate for a fixed duration, recording per-request latency and outcome.
 * Used to compare IngestEventHandler's reserved-concurrency settings before/after.
 *
 * Usage: java LoadDriver.java <apiBaseUrl> <eventsPerMinute> <durationSeconds> <outputCsvPath>
 */
public class LoadDriver {

    private static final String[] EVENT_TYPES = {"health_event", "hydraulics_event", "integrity_event"};
    private static final String[] PUMPS = {"pump-01", "pump-02", "pump-03"};

    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            System.err.println("Usage: java LoadDriver.java <apiBaseUrl> <eventsPerMinute> <durationSeconds> <outputCsvPath>");
            System.exit(1);
        }
        String apiBaseUrl = args[0];
        int eventsPerMinute = Integer.parseInt(args[1]);
        int durationSeconds = Integer.parseInt(args[2]);
        String outputCsvPath = args[3];

        double intervalMillis = 60_000.0 / eventsPerMinute;
        int totalEvents = (int) Math.round(eventsPerMinute * (durationSeconds / 60.0));

        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        ExecutorService dispatchPool = Executors.newFixedThreadPool(24);
        ConcurrentLinkedQueue<long[]> latencies = new ConcurrentLinkedQueue<>(); // [sendOffsetMs, latencyMs, statusCode]
        AtomicInteger success = new AtomicInteger();
        AtomicInteger failure = new AtomicInteger();
        List<CompletableFuture<Void>> inFlight = new ArrayList<>();

        System.out.printf("Starting load: %d events/min, %ds duration, ~%d total events, target=%s%n",
                eventsPerMinute, durationSeconds, totalEvents, apiBaseUrl);

        Instant start = Instant.now();
        for (int i = 0; i < totalEvents; i++) {
            long scheduledOffsetMs = Math.round(i * intervalMillis);
            long nowOffsetMs = Duration.between(start, Instant.now()).toMillis();
            long sleepMs = scheduledOffsetMs - nowOffsetMs;
            if (sleepMs > 0) {
                Thread.sleep(sleepMs);
            }

            String eventType = EVENT_TYPES[i % EVENT_TYPES.length];
            String pumpId = PUMPS[i % PUMPS.length];
            String body = String.format(
                    "{\"type\":\"%s\",\"pumpId\":\"%s\",\"siteId\":\"site-01\",\"seq\":%d,\"value\":%.2f}",
                    eventType, pumpId, i, 10.0 + (i % 37));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(apiBaseUrl + "/insights"))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(15))
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();

            long sendOffsetMs = Duration.between(start, Instant.now()).toMillis();
            CompletableFuture<Void> f = client.sendAsync(request, HttpResponse.BodyHandlers.discarding())
                    .handleAsync((response, ex) -> {
                        long latencyMs = Duration.between(start, Instant.now()).toMillis() - sendOffsetMs;
                        if (ex != null) {
                            failure.incrementAndGet();
                            latencies.add(new long[]{sendOffsetMs, latencyMs, -1});
                        } else {
                            int status = response.statusCode();
                            if (status >= 200 && status < 300) {
                                success.incrementAndGet();
                            } else {
                                failure.incrementAndGet();
                            }
                            latencies.add(new long[]{sendOffsetMs, latencyMs, status});
                        }
                        return null;
                    }, dispatchPool);
            inFlight.add(f);
        }

        CompletableFuture.allOf(inFlight.toArray(new CompletableFuture[0])).get(60, TimeUnit.SECONDS);
        dispatchPool.shutdown();

        List<Long> sortedLatencies = latencies.stream()
                .map(row -> row[1])
                .sorted()
                .toList();

        long p50 = percentile(sortedLatencies, 50);
        long p95 = percentile(sortedLatencies, 95);
        long p99 = percentile(sortedLatencies, 99);
        double meanMs = sortedLatencies.stream().mapToLong(Long::longValue).average().orElse(0);
        long maxMs = sortedLatencies.isEmpty() ? 0 : sortedLatencies.get(sortedLatencies.size() - 1);

        System.out.println("--- Results ---");
        System.out.printf("Requests sent   : %d%n", totalEvents);
        System.out.printf("Success (2xx)   : %d%n", success.get());
        System.out.printf("Failure         : %d%n", failure.get());
        System.out.printf("Latency mean_ms : %.1f%n", meanMs);
        System.out.printf("Latency p50_ms  : %d%n", p50);
        System.out.printf("Latency p95_ms  : %d%n", p95);
        System.out.printf("Latency p99_ms  : %d%n", p99);
        System.out.printf("Latency max_ms  : %d%n", maxMs);

        try (java.io.PrintWriter writer = new java.io.PrintWriter(new java.io.FileWriter(outputCsvPath))) {
            writer.println("send_offset_ms,latency_ms,status_code");
            for (long[] row : latencies) {
                writer.printf("%d,%d,%d%n", row[0], row[1], row[2]);
            }
        }
        System.out.println("Raw per-request rows written to " + outputCsvPath);
    }

    private static long percentile(List<Long> sorted, int pct) {
        if (sorted.isEmpty()) {
            return 0;
        }
        int index = (int) Math.ceil(pct / 100.0 * sorted.size()) - 1;
        index = Math.max(0, Math.min(index, sorted.size() - 1));
        return sorted.get(index);
    }
}
