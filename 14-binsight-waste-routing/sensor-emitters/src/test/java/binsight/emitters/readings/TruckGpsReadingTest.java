package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

class TruckGpsReadingTest {

    @Test
    @SuppressWarnings("unchecked")
    void staysWithinTheDepotPatchAndHeadingRangeAcrossManyIterations() {
        TruckGpsReading reading = new TruckGpsReading();
        for (int i = 0; i < 5000; i++) {
            Map<String, Object> coords = (Map<String, Object>) reading.nextValue();
            double lat = (double) coords.get("lat");
            double lon = (double) coords.get("lon");
            double heading = (double) coords.get("headingDeg");

            assertTrue(lat >= 53.34 && lat <= 53.36, "lat out of bounds: " + lat);
            assertTrue(lon >= -6.28 && lon <= -6.24, "lon out of bounds: " + lon);
            assertTrue(heading >= 0 && heading < 360, "headingDeg out of bounds: " + heading);
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void headingTracksTheDirectionOfTravelRatherThanJumpingFreely() {
        TruckGpsReading reading = new TruckGpsReading();
        Map<String, Object> first = (Map<String, Object>) reading.nextValue();
        double firstHeading = (double) first.get("headingDeg");

        Map<String, Object> second = (Map<String, Object>) reading.nextValue();
        double secondHeading = (double) second.get("headingDeg");

        double delta = Math.min(Math.abs(secondHeading - firstHeading), 360 - Math.abs(secondHeading - firstHeading));
        // the generator nudges heading by at most 20 degrees per tick (plus a possible 180-degree boundary bounce)
        assertTrue(delta <= 20.5 || Math.abs(delta - 180) <= 20.5, "heading changed implausibly: " + delta);
    }
}
