package binsight.emitters;

import binsight.emitters.config.MetricSchedule;
import binsight.emitters.config.SensorProfile;
import binsight.emitters.config.SensorProfileLoader;
import binsight.emitters.readings.BinWeightReading;
import binsight.emitters.readings.FillLevelReading;
import binsight.emitters.readings.FuelLevelReading;
import binsight.emitters.readings.HopperFillReading;
import binsight.emitters.readings.InternalTempReading;
import binsight.emitters.readings.LidStateReading;
import binsight.emitters.readings.MethanePpmReading;
import binsight.emitters.readings.ReadingGenerator;
import binsight.emitters.readings.TiltReading;
import binsight.emitters.readings.TruckGpsReading;
import binsight.emitters.readings.WeighbridgeTonnageReading;
import binsight.emitters.transport.MqttReadingPublisher;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Boots one reading generator + one publish schedule per (entity, metric) pair,
 * each metric sampling and dispatching on its own independently configured cadence.
 */
public final class EmitterMain {

    private static final Map<String, String> ENTITY_TYPES = Map.of(
            "bin-01", "bin",
            "bin-02", "bin",
            "bin-03", "bin",
            "truck-01", "truck",
            "depot-01", "depot"
    );

    private EmitterMain() {
    }

    public static void main(String[] args) throws Exception {
        String brokerUrl = System.getenv().getOrDefault("BINSIGHT_MQTT_BROKER_URL", "tcp://localhost:1883");
        SensorProfileLoader loader = new SensorProfileLoader();
        MqttReadingPublisher publisher = new MqttReadingPublisher(brokerUrl);
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(ENTITY_TYPES.size() * 4);

        for (Map.Entry<String, String> entry : ENTITY_TYPES.entrySet()) {
            String entityId = entry.getKey();
            String entityType = entry.getValue();
            SensorProfile profile = loader.load(entityId);
            scheduleEntity(profile, entityType, publisher, scheduler);
        }

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            scheduler.shutdownNow();
            try {
                publisher.close();
            } catch (Exception ignored) {
                // best-effort shutdown, nothing left to recover from here
            }
        }));
    }

    private static void scheduleEntity(SensorProfile profile, String entityType,
                                        MqttReadingPublisher publisher, ScheduledExecutorService scheduler) {
        String entityId = profile.getEntityId();
        for (MetricSchedule schedule : profile.getSchedulesByMetric().values()) {
            ReadingGenerator generator = newGenerator(schedule.getMetric());
            AtomicReference<Object> latestValue = new AtomicReference<>(generator.nextValue());

            scheduler.scheduleAtFixedRate(
                    () -> latestValue.set(generator.nextValue()),
                    0, schedule.getSampleIntervalSeconds(), TimeUnit.SECONDS);

            scheduler.scheduleAtFixedRate(
                    () -> publishSafely(publisher, entityId, entityType, generator, latestValue.get()),
                    schedule.getDispatchIntervalSeconds(), schedule.getDispatchIntervalSeconds(), TimeUnit.SECONDS);
        }
    }

    private static void publishSafely(MqttReadingPublisher publisher, String entityId, String entityType,
                                       ReadingGenerator generator, Object value) {
        try {
            publisher.publish(entityId, entityType, generator.metricName(), value, generator.unit());
        } catch (Exception e) {
            // a single dropped publish shouldn't kill the scheduler thread for every other metric
            System.err.println("Failed to publish " + generator.metricName() + " for " + entityId + ": " + e.getMessage());
        }
    }

    private static ReadingGenerator newGenerator(String metric) {
        return switch (metric) {
            case "fill-level" -> new FillLevelReading();
            case "bin-weight" -> new BinWeightReading();
            case "lid-state" -> new LidStateReading();
            case "internal-temp" -> new InternalTempReading();
            case "methane-ppm" -> new MethanePpmReading();
            case "tilt" -> new TiltReading();
            case "truck-gps" -> new TruckGpsReading();
            case "hopper-fill" -> new HopperFillReading();
            case "fuel-level" -> new FuelLevelReading();
            case "weighbridge-tonnage" -> new WeighbridgeTonnageReading();
            default -> throw new IllegalArgumentException("Unknown metric: " + metric);
        };
    }

    static List<String> knownEntityIds() {
        return new ArrayList<>(ENTITY_TYPES.keySet());
    }
}
