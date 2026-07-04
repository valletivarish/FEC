package ie.nci.flowforge.rig;

import ie.nci.flowforge.rig.channels.ChannelFactory;
import ie.nci.flowforge.rig.channels.SensorChannel;
import ie.nci.flowforge.rig.config.PumpConfig;
import ie.nci.flowforge.rig.config.PumpConfigLoader;
import ie.nci.flowforge.rig.config.SensorScheduleConfig;
import ie.nci.flowforge.rig.mqtt.MqttReadingPublisher;
import ie.nci.flowforge.rig.mqtt.SensorReading;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Entry point for one pump rig. Each sensor metric gets its own scheduled thread so its
 * sampleIntervalSeconds/dispatchIntervalSeconds are independent of every other metric on the pump.
 */
public final class PumpRigLauncher {

    private static final Logger LOG = LoggerFactory.getLogger(PumpRigLauncher.class);

    public static void main(String[] args) {
        String configResource = args.length > 0 ? args[0] : "pump-01.yaml";
        PumpConfig config = new PumpConfigLoader().loadFromClasspath(configResource);

        String clientId = "rig-emulator-" + config.getPumpId();
        try (MqttReadingPublisher publisher = new MqttReadingPublisher(config.getMqttBrokerUrl(), clientId)) {
            PumpRigLauncher launcher = new PumpRigLauncher();
            List<ScheduledExecutorService> executors = launcher.start(config, publisher);
            Runtime.getRuntime().addShutdownHook(new Thread(() -> executors.forEach(ScheduledExecutorService::shutdownNow)));
            Thread.currentThread().join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            LOG.info("Rig launcher interrupted, shutting down");
        }
    }

    /** Package-visible so tests can start a rig against a config without going through main(). */
    List<ScheduledExecutorService> start(PumpConfig config, MqttReadingPublisher publisher) {
        List<ScheduledExecutorService> executors = new ArrayList<>();
        for (SensorScheduleConfig sensorConfig : config.getSensors()) {
            executors.addAll(startChannel(config.getPumpId(), sensorConfig, publisher));
        }
        return executors;
    }

    private List<ScheduledExecutorService> startChannel(String pumpId, SensorScheduleConfig scheduleConfig,
                                                          MqttReadingPublisher publisher) {
        SensorChannel channel = ChannelFactory.create(scheduleConfig.getMetric());
        AtomicReference<Double> latestValue = new AtomicReference<>(channel.initialValue());

        ScheduledExecutorService sampleExecutor = Executors.newSingleThreadScheduledExecutor(
                runnable -> new Thread(runnable, pumpId + "-" + channel.metricName() + "-sample"));
        sampleExecutor.scheduleAtFixedRate(
                () -> latestValue.set(channel.nextValue(latestValue.get())),
                0, scheduleConfig.getSampleIntervalSeconds(), TimeUnit.SECONDS);

        ScheduledExecutorService dispatchExecutor = Executors.newSingleThreadScheduledExecutor(
                runnable -> new Thread(runnable, pumpId + "-" + channel.metricName() + "-dispatch"));
        dispatchExecutor.scheduleAtFixedRate(
                () -> publishReading(pumpId, channel, latestValue.get(), publisher),
                scheduleConfig.getDispatchIntervalSeconds(), scheduleConfig.getDispatchIntervalSeconds(),
                TimeUnit.SECONDS);

        return List.of(sampleExecutor, dispatchExecutor);
    }

    private void publishReading(String pumpId, SensorChannel channel, double value, MqttReadingPublisher publisher) {
        SensorReading reading = new SensorReading(pumpId, channel.metricName(), value, channel.unit(),
                Instant.now().toString());
        publisher.publish(reading);
    }
}
