package com.guardianedge.sensorsim;

import com.guardianedge.sensorsim.config.MetricSchedule;
import com.guardianedge.sensorsim.config.ResidentConfigLoader;
import com.guardianedge.sensorsim.config.ResidentSensorConfig;
import com.guardianedge.sensorsim.emit.MotionEmitter;
import com.guardianedge.sensorsim.emit.RoomEnvEmitter;
import com.guardianedge.sensorsim.emit.VitalSignEmitter;
import com.guardianedge.sensorsim.model.SensorReading;
import com.guardianedge.sensorsim.mqtt.SensorMqttPublisher;
import java.util.List;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Wires all 3 emitters for all 3 residents onto independent SensorClock schedules and publishes over MQTT. */
public final class SensorRigLauncher {

    private static final Logger LOG = LoggerFactory.getLogger(SensorRigLauncher.class);
    private static final List<String> RESIDENT_IDS = List.of("resident-01", "resident-02", "resident-03");
    private static final int THREADS_PER_RESIDENT = 20;

    public static void main(String[] args) {
        String brokerUrl = System.getenv().getOrDefault("GUARDIANEDGE_MQTT_BROKER_URL", "tcp://localhost:1883");
        ResidentConfigLoader configLoader = new ResidentConfigLoader();
        SensorMqttPublisher publisher = new SensorMqttPublisher(brokerUrl, "sensor-sim-" + System.currentTimeMillis());
        SensorClock clock = new SensorClock(RESIDENT_IDS.size() * THREADS_PER_RESIDENT);

        for (String residentId : RESIDENT_IDS) {
            ResidentSensorConfig config = configLoader.loadFromClasspath(residentId + ".yaml");
            wireResident(clock, publisher, config);
        }

        LOG.info("GuardianEdge sensor rig running for {} residents against {}", RESIDENT_IDS.size(), brokerUrl);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            clock.shutdown();
            publisher.close();
        }));
    }

    private static void wireResident(SensorClock clock, SensorMqttPublisher publisher, ResidentSensorConfig config) {
        String residentId = config.getResidentId();
        VitalSignEmitter vitals = new VitalSignEmitter(residentId);
        MotionEmitter motion = new MotionEmitter(residentId);
        RoomEnvEmitter roomEnv = new RoomEnvEmitter(residentId);

        scheduleVital(clock, publisher, config, "heartrate", vitals::nextHeartrate);
        scheduleVital(clock, publisher, config, "spo2", vitals::nextSpo2);
        scheduleVital(clock, publisher, config, "resprate", vitals::nextResprate);
        scheduleVital(clock, publisher, config, "skintemp", vitals::nextSkintemp);
        scheduleVital(clock, publisher, config, "ecgrr", vitals::nextEcgrr);

        scheduleVital(clock, publisher, config, "accelerometer", motion::nextAccelerometer);
        scheduleVital(clock, publisher, config, "gyroscope", motion::nextGyroscope);

        scheduleVital(clock, publisher, config, "room-pir", roomEnv::nextRoomPir);
        scheduleVital(clock, publisher, config, "room-ambienttemp", roomEnv::nextRoomAmbientTemp);
        scheduleVital(clock, publisher, config, "room-airquality", roomEnv::nextRoomAirQuality);
    }

    private static void scheduleVital(SensorClock clock, SensorMqttPublisher publisher,
                                       ResidentSensorConfig config, String metric,
                                       Supplier<SensorReading> sampler) {
        MetricSchedule schedule = config.scheduleFor(metric);
        clock.scheduleMetric(config.getResidentId() + ":" + metric,
                schedule.getSampleIntervalSeconds(), schedule.getDispatchIntervalSeconds(),
                sampler, publisher::publish);
    }

    private SensorRigLauncher() {
    }
}
