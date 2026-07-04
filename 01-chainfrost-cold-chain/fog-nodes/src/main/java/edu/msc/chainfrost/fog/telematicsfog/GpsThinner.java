package edu.msc.chainfrost.fog.telematicsfog;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reduces GPS chatter to only the points that actually change the route picture,
 * so we don't ship a data point for every near-identical fix on a straight highway.
 */
public class GpsThinner {

    private static final double DEVIATION_THRESHOLD_METERS = 25.0;
    private static final Duration MAX_GAP = Duration.ofMinutes(5);
    private static final double SPEED_CHANGE_THRESHOLD_KMH = 20.0;
    private static final double EARTH_RADIUS_METERS = 6_371_000.0;

    private final Map<String, GpsPoint> lastDispatchedByTruck = new ConcurrentHashMap<>();

    public Optional<GpsPoint> offer(String truckId, GpsPoint candidate) {
        GpsPoint lastDispatched = lastDispatchedByTruck.get(truckId);
        if (lastDispatched == null || shouldDispatch(lastDispatched, candidate)) {
            lastDispatchedByTruck.put(truckId, candidate);
            return Optional.of(candidate);
        }
        return Optional.empty();
    }

    private boolean shouldDispatch(GpsPoint last, GpsPoint candidate) {
        double deviationMeters = haversineMeters(last.lat(), last.lon(), candidate.lat(), candidate.lon());
        if (deviationMeters > DEVIATION_THRESHOLD_METERS) {
            return true;
        }
        Duration elapsed = Duration.between(last.timestamp(), candidate.timestamp());
        if (elapsed.compareTo(MAX_GAP) > 0) {
            return true;
        }
        return Math.abs(candidate.speedKmh() - last.speedKmh()) > SPEED_CHANGE_THRESHOLD_KMH;
    }

    static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double phi1 = Math.toRadians(lat1);
        double phi2 = Math.toRadians(lat2);
        double deltaPhi = Math.toRadians(lat2 - lat1);
        double deltaLambda = Math.toRadians(lon2 - lon1);

        double a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2)
                + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return EARTH_RADIUS_METERS * c;
    }
}
