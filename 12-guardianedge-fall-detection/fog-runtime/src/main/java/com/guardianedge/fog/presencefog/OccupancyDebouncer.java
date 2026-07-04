package com.guardianedge.fog.presencefog;

import java.util.ArrayDeque;
import java.util.Deque;

/** Debounces raw room-pir readings into a stable OCCUPIED/UNOCCUPIED state per resident. */
public class OccupancyDebouncer {

    private static final int WINDOW_SIZE = 5;
    private static final int OCCUPIED_THRESHOLD = 3;
    private static final int UNOCCUPIED_CONSECUTIVE_ZEROES = 10;

    private final Deque<Integer> recentReadings = new ArrayDeque<>();
    private boolean occupied = false;
    private int consecutiveZeroes = 0;

    /** Feeds one room-pir reading (0 or 1); returns true if the debounced state changed this call. */
    public boolean addReading(int pirValue) {
        recentReadings.addLast(pirValue);
        if (recentReadings.size() > WINDOW_SIZE) {
            recentReadings.removeFirst();
        }

        if (pirValue == 0) {
            consecutiveZeroes++;
        } else {
            consecutiveZeroes = 0;
        }

        boolean wasOccupied = occupied;
        if (!occupied) {
            long onesInWindow = recentReadings.stream().filter(v -> v == 1).count();
            if (onesInWindow >= OCCUPIED_THRESHOLD) {
                occupied = true;
            }
        } else {
            if (consecutiveZeroes >= UNOCCUPIED_CONSECUTIVE_ZEROES) {
                occupied = false;
            }
        }
        return occupied != wasOccupied;
    }

    public boolean isOccupied() {
        return occupied;
    }
}
