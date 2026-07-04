package edu.msc.floodwatch.fog.hydro;

/** Flood risk stage for a reach, ordered low to high risk. */
public enum Stage {
    GREEN,
    AMBER,
    RED;

    /** One level higher than this stage, or itself if already at the top (RED stays RED). */
    Stage escalateOnce() {
        return switch (this) {
            case GREEN -> AMBER;
            case AMBER -> RED;
            case RED -> RED;
        };
    }
}
