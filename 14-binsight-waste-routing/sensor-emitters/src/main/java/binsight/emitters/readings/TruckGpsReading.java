package binsight.emitters.readings;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Truck GPS as {lat, lon, headingDeg}. Heading is derived from the actual
 * lat/lon step taken, not sampled independently, so the truck visibly drives
 * in the direction it reports rather than teleporting with a random facing.
 */
public class TruckGpsReading implements ReadingGenerator {

    private static final double LAT_MIN = 53.34;
    private static final double LAT_MAX = 53.36;
    private static final double LON_MIN = -6.28;
    private static final double LON_MAX = -6.24;
    private static final double STEP_DEGREES = 0.0006;

    private double lat;
    private double lon;
    private double headingDeg;

    public TruckGpsReading() {
        this.lat = ThreadLocalRandom.current().nextDouble(LAT_MIN, LAT_MAX);
        this.lon = ThreadLocalRandom.current().nextDouble(LON_MIN, LON_MAX);
        this.headingDeg = ThreadLocalRandom.current().nextDouble(0, 360);
    }

    @Override
    public String metricName() {
        return "truck-gps";
    }

    @Override
    public String unit() {
        return "coords";
    }

    @Override
    public Object nextValue() {
        // nudge heading slightly rather than resampling it, so travel direction is coherent tick-to-tick
        headingDeg = wrapHeading(headingDeg + ThreadLocalRandom.current().nextDouble(-20, 20));

        double proposedLat = lat + STEP_DEGREES * Math.cos(Math.toRadians(headingDeg));
        double proposedLon = lon + STEP_DEGREES * Math.sin(Math.toRadians(headingDeg));

        if (proposedLat < LAT_MIN || proposedLat > LAT_MAX || proposedLon < LON_MIN || proposedLon > LON_MAX) {
            // bounce off the depot-patch boundary by reversing direction of travel
            headingDeg = wrapHeading(headingDeg + 180);
            proposedLat = lat + STEP_DEGREES * Math.cos(Math.toRadians(headingDeg));
            proposedLon = lon + STEP_DEGREES * Math.sin(Math.toRadians(headingDeg));
        }

        lat = clamp(proposedLat, LAT_MIN, LAT_MAX);
        lon = clamp(proposedLon, LON_MIN, LON_MAX);

        Map<String, Object> coords = new LinkedHashMap<>();
        coords.put("lat", lat);
        coords.put("lon", lon);
        coords.put("headingDeg", headingDeg);
        return coords;
    }

    private static double wrapHeading(double heading) {
        double wrapped = heading % 360;
        return wrapped < 0 ? wrapped + 360 : wrapped;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
