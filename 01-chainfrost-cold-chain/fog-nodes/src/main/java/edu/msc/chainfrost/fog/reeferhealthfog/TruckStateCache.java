package edu.msc.chainfrost.fog.reeferhealthfog;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Latest-known telematics speed per truck, shared across correlation checks that
 * need it (e.g. distinguishing a loading-dock door open from an in-transit one).
 */
class TruckStateCache {

    private final Map<String, Double> latestSpeedByTruck = new ConcurrentHashMap<>();

    void recordSpeed(String truckId, double speedKmh) {
        latestSpeedByTruck.put(truckId, speedKmh);
    }

    double latestSpeed(String truckId) {
        return latestSpeedByTruck.getOrDefault(truckId, 0.0);
    }
}
