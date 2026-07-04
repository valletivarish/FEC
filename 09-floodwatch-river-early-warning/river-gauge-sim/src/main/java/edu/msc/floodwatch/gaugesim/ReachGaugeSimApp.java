package edu.msc.floodwatch.gaugesim;

import edu.msc.floodwatch.gaugesim.config.ReachGaugeConfig;
import edu.msc.floodwatch.gaugesim.config.ReachGaugeConfigLoader;
import edu.msc.floodwatch.gaugesim.config.SensorScheduleConfig;
import edu.msc.floodwatch.gaugesim.generators.MetricGenerator;
import edu.msc.floodwatch.gaugesim.generators.MetricGeneratorFactory;
import edu.msc.floodwatch.gaugesim.mqtt.MqttReadingPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Entry point for one reach's gauge simulation: loads its YAML config, spawns one thread per
 * sensor metric, and publishes all readings to the reach's MQTT broker until interrupted.
 * Usage: java -jar river-gauge-sim.jar <config-classpath-resource>
 */
public class ReachGaugeSimApp {

    private static final Logger LOG = LoggerFactory.getLogger(ReachGaugeSimApp.class);

    public static void main(String[] args) throws Exception {
        String configResource = args.length > 0 ? args[0] : "reach-upper.yaml";

        ReachGaugeConfigLoader loader = new ReachGaugeConfigLoader();
        ReachGaugeConfig config = loader.loadFromClasspath(configResource);

        MqttReadingPublisher publisher = new MqttReadingPublisher(
                config.getMqttBrokerUrl(), "gauge-sim-" + config.getReachId());

        ExecutorService executor = Executors.newFixedThreadPool(config.getSensors().size());
        List<SensorWorker> workers = new ArrayList<>();

        for (Map.Entry<String, SensorScheduleConfig> entry : config.getSensors().entrySet()) {
            String metricName = entry.getKey();
            SensorScheduleConfig schedule = entry.getValue();
            MetricGenerator generator = MetricGeneratorFactory.create(metricName);
            SensorWorker worker = new SensorWorker(config.getReachId(), generator, schedule, publisher);
            workers.add(worker);
            executor.submit(worker);
        }

        LOG.info("Started {} sensor workers for reach {}", workers.size(), config.getReachId());

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            LOG.info("Shutting down gauge sim for reach {}", config.getReachId());
            workers.forEach(SensorWorker::stop);
            executor.shutdownNow();
            publisher.close();
        }));
    }
}
