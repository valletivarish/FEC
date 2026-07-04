package edu.msc.floodwatch.backend.ingest;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

import java.util.Map;

/**
 * POST /events - API Gateway has no direct SQS integration usable here, so this relays the
 * raw body onto the intake queue unparsed; ReachIntakeHandler still owns all validation.
 */
public class ReachEventRelayHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final SqsClient sqsClient;
    private final String queueUrl;

    public ReachEventRelayHandler() {
        this(SqsClient.builder().build(), System.getenv("FLOODWATCH_INTAKE_QUEUE_URL"));
    }

    public ReachEventRelayHandler(SqsClient sqsClient, String queueUrl) {
        this.sqsClient = sqsClient;
        this.queueUrl = queueUrl;
    }

    @Override
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        Object body = event.get("body");
        if (body == null) {
            return Map.of("statusCode", 400, "body", "{\"message\":\"missing request body\"}");
        }

        try {
            sqsClient.sendMessage(SendMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .messageBody(String.valueOf(body))
                    .build());
            return Map.of("statusCode", 202, "body", "{\"message\":\"queued\"}");
        } catch (Exception e) {
            return Map.of("statusCode", 502, "body", "{\"message\":\"" + e.getMessage() + "\"}");
        }
    }
}
