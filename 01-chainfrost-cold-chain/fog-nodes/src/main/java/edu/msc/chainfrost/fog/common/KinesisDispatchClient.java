package edu.msc.chainfrost.fog.common;

import java.io.UncheckedIOException;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.kinesis.KinesisClient;
import software.amazon.awssdk.services.kinesis.model.PutRecordRequest;

/**
 * Publishes FogEvents to the Kinesis telemetry stream. Retries transient failures
 * with backoff, then parks the event in a bounded queue for replay so a brief
 * network blip cannot silently drop cold-chain evidence.
 */
public class KinesisDispatchClient {

    private static final String STREAM_NAME = "chainfrost-telemetry-stream";
    private static final int MAX_ATTEMPTS = 3;
    private static final long[] BACKOFF_MILLIS = {200L, 400L, 800L};
    private static final int FALLBACK_CAPACITY = 200;
    private static final long REPLAY_INTERVAL_SECONDS = 30L;

    private final KinesisClient kinesisClient;
    private final RingBuffer<FogEvent> fallbackQueue = new RingBuffer<>(FALLBACK_CAPACITY);
    private final ScheduledExecutorService replayExecutor = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "kinesis-fallback-replay");
        thread.setDaemon(true);
        return thread;
    });

    public KinesisDispatchClient(KinesisClient kinesisClient) {
        this.kinesisClient = kinesisClient;
        replayExecutor.scheduleWithFixedDelay(
                this::replayFallbackQueue, REPLAY_INTERVAL_SECONDS, REPLAY_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    public void dispatch(FogEvent event) {
        if (!trySendWithRetry(event)) {
            fallbackQueue.offer(event);
        }
    }

    private boolean trySendWithRetry(FogEvent event) {
        for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            if (attempt > 0) {
                sleepQuietly(BACKOFF_MILLIS[attempt - 1]);
            }
            if (send(event)) {
                return true;
            }
        }
        return false;
    }

    private boolean send(FogEvent event) {
        try {
            byte[] payload = JsonSupport.MAPPER.writeValueAsBytes(event);
            PutRecordRequest request = PutRecordRequest.builder()
                    .streamName(STREAM_NAME)
                    .partitionKey(event.truckId())
                    .data(SdkBytes.fromByteArray(payload))
                    .build();
            kinesisClient.putRecord(request);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void replayFallbackQueue() {
        List<FogEvent> pending = fallbackQueue.drainAll();
        for (FogEvent event : pending) {
            if (!trySendWithRetry(event)) {
                fallbackQueue.offer(event);
            }
        }
    }

    private void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new UncheckedIOException(new java.io.IOException("interrupted during backoff", e));
        }
    }

    public int fallbackQueueSize() {
        return fallbackQueue.size();
    }

    public void shutdown() {
        replayExecutor.shutdownNow();
    }
}
