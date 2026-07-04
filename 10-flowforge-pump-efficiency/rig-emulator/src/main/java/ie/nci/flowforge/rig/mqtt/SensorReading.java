package ie.nci.flowforge.rig.mqtt;

/** Wire shape fixed by the shared contract: pumpId, metric, value, unit, timestamp. */
public class SensorReading {

    private String pumpId;
    private String metric;
    private double value;
    private String unit;
    private String timestamp;

    public SensorReading() {
    }

    public SensorReading(String pumpId, String metric, double value, String unit, String timestamp) {
        this.pumpId = pumpId;
        this.metric = metric;
        this.value = value;
        this.unit = unit;
        this.timestamp = timestamp;
    }

    public String getPumpId() {
        return pumpId;
    }

    public void setPumpId(String pumpId) {
        this.pumpId = pumpId;
    }

    public String getMetric() {
        return metric;
    }

    public void setMetric(String metric) {
        this.metric = metric;
    }

    public double getValue() {
        return value;
    }

    public void setValue(double value) {
        this.value = value;
    }

    public String getUnit() {
        return unit;
    }

    public void setUnit(String unit) {
        this.unit = unit;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(String timestamp) {
        this.timestamp = timestamp;
    }
}
