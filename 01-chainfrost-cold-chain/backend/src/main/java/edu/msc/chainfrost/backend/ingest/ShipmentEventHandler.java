package edu.msc.chainfrost.backend.ingest;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.KinesisEvent;
import edu.msc.chainfrost.backend.util.JsonMapper;
import edu.msc.chainfrost.fog.common.FogEvent;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

import java.nio.charset.StandardCharsets;

/**
 * Kinesis-triggered entrypoint that fans FogEvent records out to the
 * table matching each event's domain (excursion, fault, or telematics).
 */
public class ShipmentEventHandler implements RequestHandler<KinesisEvent, Void> {

    private final DynamoWriter dynamoWriter;

    public ShipmentEventHandler() {
        this(new DynamoWriter(DynamoDbClient.create()));
    }

    public ShipmentEventHandler(DynamoWriter dynamoWriter) {
        this.dynamoWriter = dynamoWriter;
    }

    @Override
    public Void handleRequest(KinesisEvent event, Context context) {
        LambdaLogger logger = context.getLogger();

        for (KinesisEvent.KinesisEventRecord record : event.getRecords()) {
            try {
                byte[] data = record.getKinesis().getData().array();
                FogEvent fogEvent = JsonMapper.INSTANCE.readValue(
                        new String(data, StandardCharsets.UTF_8), FogEvent.class);
                dispatch(fogEvent);
            } catch (Exception e) {
                // one malformed record must not fail the whole Kinesis batch
                logger.log("Skipping unprocessable record: " + e.getMessage());
            }
        }
        return null;
    }

    private void dispatch(FogEvent fogEvent) {
        String eventType = fogEvent.eventType();
        if (eventType.startsWith("EXCURSION_")) {
            dynamoWriter.writeZoneTempSample(fogEvent);
            dynamoWriter.upsertShipmentStatus(fogEvent);
        } else if (eventType.equals("REEFER_FAULT")) {
            dynamoWriter.writeFaultEvent(fogEvent);
        } else if (eventType.equals("REEFER_STATUS")) {
            dynamoWriter.upsertShipmentHumidity(fogEvent);
        } else if (eventType.startsWith("TELEMATICS_")) {
            dynamoWriter.upsertShipmentPosition(fogEvent);
        }
    }
}
