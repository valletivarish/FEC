package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertTrue;

class LidStateReadingTest {

    @Test
    void alwaysProducesAKnownEnumValueAndMostlyClosed() {
        LidStateReading reading = new LidStateReading();
        Set<String> allowed = Set.of("CLOSED", "OPEN", "AJAR");
        int closedCount = 0;
        int iterations = 5000;
        for (int i = 0; i < iterations; i++) {
            String value = (String) reading.nextValue();
            assertTrue(allowed.contains(value), "unexpected lid state: " + value);
            if (value.equals("CLOSED")) {
                closedCount++;
            }
        }
        // majority-closed is a behavioural contract, not just a bounds check
        assertTrue(closedCount > iterations * 0.6, "expected lid state to be mostly CLOSED, got " + closedCount);
    }
}
