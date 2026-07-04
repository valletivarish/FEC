package com.guardianedge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

import java.util.HashMap;
import java.util.Map;

/** Fronts the alert queue with an HTTP route: relays the fog dispatcher's raw POST body onto SQS unparsed. */
public class EventRelayHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final SqsClient sqsClient;
    private final String queueUrl;

    public EventRelayHandler() {
        this(SqsClient.builder().build(), System.getenv("GUARDIANEDGE_ALERT_QUEUE_URL"));
    }

    public EventRelayHandler(SqsClient sqsClient) {
        this(sqsClient, System.getenv("GUARDIANEDGE_ALERT_QUEUE_URL"));
    }

    public EventRelayHandler(SqsClient sqsClient, String queueUrl) {
        this.sqsClient = sqsClient;
        this.queueUrl = queueUrl;
    }

    @Override
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        Object bodyRaw = event.get("body");
        String body = bodyRaw == null ? "" : bodyRaw.toString();

        if (body.isBlank()) {
            return response(400, "{\"message\":\"Empty body\"}");
        }

        try {
            // FIFO queue behind this route needs a group/dedup id; residentId isn't parsed here, so use the request itself
            sqsClient.sendMessage(SendMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .messageBody(body)
                    .messageGroupId("fog-events")
                    .messageDeduplicationId(context.getAwsRequestId())
                    .build());
            return response(202, "{\"message\":\"Accepted\"}");
        } catch (Exception e) {
            context.getLogger().log("EventRelayHandler error: " + e.getMessage());
            return response(502, "{\"message\":\"Relay failed\"}");
        }
    }

    private Map<String, Object> response(int statusCode, String body) {
        Map<String, Object> result = new HashMap<>();
        result.put("statusCode", statusCode);
        result.put("headers", Map.of("Content-Type", "application/json"));
        result.put("body", body);
        return result;
    }
}
