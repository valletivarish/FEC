package edu.msc.floodwatch.gaugesim;

import edu.msc.floodwatch.gaugesim.config.SensorScheduleConfig;
import edu.msc.floodwatch.gaugesim.generators.MetricGenerator;
import edu.msc.floodwatch.gaugesim.mqtt.MqttReadingPublisher;
import edu.msc.floodwatch.gaugesim.mqtt.SensorReading;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;

/**
 * Runs one sensor metric on its own thread with independent sample vs. dispatch cadence:
 * sampling regenerates the value, dispatch publishes the latest sampled value over MQTT.
 * The two loop on the GCD of their intervals so each fires exactly on its own period.
 */
public class SensorWorker implements Runnable {

    private static final Logger LOG = LoggerFactory.getLogger(SensorWorker.class);

    private final String reachId;
    private final MetricGenerator generator;
    private final SensorScheduleConfig schedule;
    private final MqttReadingPublisher publisher;

    private volatile boolean running = true;
    private double currentValue;

    public SensorWorker(String reachId, MetricGenerator generator, SensorScheduleConfig schedule,
                         MqttReadingPublisher publisher) {
        this.reachId = reachId;
        this.generator = generator;
        this.schedule = schedule;
        this.publisher = publisher;
        this.currentValue = generator.initialValue();
    }

    public void stop() {
        running = false;
    }

    @Override
    public void run() {
        long tickSeconds = gcd(schedule.getSampleIntervalSeconds(), schedule.getDispatchIntervalSeconds());
        long elapsedSeconds = 0;
        try {
            while (running) {
                Thread.sleep(tickSeconds * 1000L);
                elapsedSeconds += tickSeconds;

                if (elapsedSeconds % schedule.getSampleIntervalSeconds() == 0) {
                    currentValue = generator.nextValue(currentValue);
                }
                if (elapsedSeconds % schedule.getDispatchIntervalSeconds() == 0) {
                    SensorReading reading = new SensorReading(
                            reachId, generator.metricName(), currentValue, generator.unit(),
                            Instant.now().toString());
                    publisher.publish(reading);
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            LOG.info("Sensor worker for {}/{} interrupted, stopping", reachId, generator.metricName());
        }
    }

    private static long gcd(long a, long b) {
        return b == 0 ? a : gcd(b, a % b);
    }
}
