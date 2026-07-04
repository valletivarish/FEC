package edu.msc.chainfrost.fog;

import software.amazon.awssdk.services.kinesis.KinesisClient;

import edu.msc.chainfrost.fog.common.KinesisDispatchClient;
import edu.msc.chainfrost.fog.common.MqttReadingSubscriber;
import edu.msc.chainfrost.fog.reeferhealthfog.ReeferHealthFogNode;
import edu.msc.chainfrost.fog.telematicsfog.TelematicsFogNode;
import edu.msc.chainfrost.fog.tempfog.TempFogNode;

/**
 * Process entrypoint for the fog tier. One MQTT connection and one Kinesis
 * dispatcher are shared by all three fog nodes, each handling every truck.
 */
public final class FogRuntimeApp {

    private FogRuntimeApp() {
    }

    public static void main(String[] args) throws Exception {
        KinesisClient kinesisClient = KinesisClient.builder().build();
        KinesisDispatchClient dispatchClient = new KinesisDispatchClient(kinesisClient);
        MqttReadingSubscriber subscriber = new MqttReadingSubscriber();

        TempFogNode tempFogNode = new TempFogNode(dispatchClient);
        ReeferHealthFogNode reeferHealthFogNode = new ReeferHealthFogNode(dispatchClient);
        TelematicsFogNode telematicsFogNode = new TelematicsFogNode(dispatchClient);

        registerConsumers(subscriber, tempFogNode, reeferHealthFogNode, telematicsFogNode);

        subscriber.start();

        Runtime.getRuntime().addShutdownHook(new Thread(() -> shutdown(subscriber, dispatchClient, telematicsFogNode)));

        Thread.currentThread().join();
    }

    private static void registerConsumers(
            MqttReadingSubscriber subscriber,
            TempFogNode tempFogNode,
            ReeferHealthFogNode reeferHealthFogNode,
            TelematicsFogNode telematicsFogNode) {

        subscriber.onTopicSuffix("reefer/zone1/temp", tempFogNode::onZone1Reading);
        subscriber.onTopicSuffix("reefer/zone2/temp", tempFogNode::onZone2Reading);
        subscriber.onTopicSuffix("reefer/setpoint", tempFogNode::onSetpointReading);

        subscriber.onTopicSuffix("reefer/setpoint", reeferHealthFogNode::onSetpointReading);
        subscriber.onTopicSuffix("reefer/zone1/temp", reeferHealthFogNode::onZoneTempReading);
        subscriber.onTopicSuffix("reefer/door_state", reeferHealthFogNode::onDoorStateReading);
        subscriber.onTopicSuffix("reefer/compressor_current", reeferHealthFogNode::onCompressorCurrentReading);
        subscriber.onTopicSuffix("reefer/battery_level", reeferHealthFogNode::onBatteryLevelReading);
        subscriber.onTopicSuffix("reefer/humidity", reeferHealthFogNode::onHumidityReading);
        subscriber.onTopicSuffix("telematics/speed", reeferHealthFogNode::onSpeedReading);

        subscriber.onTopicSuffix("telematics/speed", telematicsFogNode::onSpeedReading);
        subscriber.onRawTopicSuffix("telematics/gps", telematicsFogNode::onGpsReading);
        subscriber.onTopicSuffix("telematics/shock", telematicsFogNode::onShockReading);
    }

    private static void shutdown(
            MqttReadingSubscriber subscriber, KinesisDispatchClient dispatchClient, TelematicsFogNode telematicsFogNode) {
        try {
            subscriber.stop();
        } catch (Exception e) {
            // best-effort on shutdown, process is exiting regardless
        }
        telematicsFogNode.shutdown();
        dispatchClient.shutdown();
    }
}
