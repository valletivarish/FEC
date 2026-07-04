package edu.msc.chainfrost.reefersim;

import edu.msc.chainfrost.reefersim.config.FleetConfigLoader;
import edu.msc.chainfrost.reefersim.config.SensorProfile;
import edu.msc.chainfrost.reefersim.simulation.SensorSimulator;
import edu.msc.chainfrost.reefersim.transport.MqttReadingPublisher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;

/**
 * Boots one MQTT publisher and one SensorSimulator per (truck, topic) pair
 * for a simulated fleet, then runs until the process receives a shutdown signal.
 */
public class ReeferFleetSimApp {

    public static void main(String[] args) {
        int fleetSize = Integer.parseInt(System.getenv().getOrDefault("FLEET_SIZE", "3"));
        FleetConfigLoader configLoader = new FleetConfigLoader();

        List<MqttReadingPublisher> publishers = new ArrayList<>();
        List<SensorSimulator> simulators = new ArrayList<>();
        ScheduledExecutorService executor = Executors.newScheduledThreadPool(Math.max(4, fleetSize * 4));

        for (int i = 1; i <= fleetSize; i++) {
            String truckId = String.format("truck-%02d", i);
            MqttReadingPublisher publisher = new MqttReadingPublisher(truckId);
            publishers.add(publisher);

            List<SensorProfile> profiles = configLoader.loadForTruck(truckId);
            for (SensorProfile profile : profiles) {
                SensorSimulator simulator = new SensorSimulator(truckId, profile, executor, publisher::publish);
                if ("GPS_RANDOM_WALK".equals(profile.valueModel())) {
                    publisher.registerGpsSimulator(simulator);
                }
                simulators.add(simulator);
                simulator.start();
            }
            System.out.println("Started " + profiles.size() + " sensors for " + truckId);
        }

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Shutting down reefer-sim fleet...");
            simulators.forEach(SensorSimulator::stop);
            executor.shutdown();
            publishers.forEach(MqttReadingPublisher::close);
        }));

        System.out.println("ChainFrost reefer-sim running with " + fleetSize + " trucks. Press Ctrl+C to stop.");
        blockForever();
    }

    private static void blockForever() {
        try {
            Thread.currentThread().join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
