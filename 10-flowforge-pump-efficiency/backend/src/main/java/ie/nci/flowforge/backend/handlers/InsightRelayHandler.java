package ie.nci.flowforge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import ie.nci.flowforge.backend.support.ProxyResponses;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

import java.util.Map;

/**
 * API Gateway proxy target InsightDispatcher POSTs to at /insights. Relays the raw
 * body onto the insight queue verbatim - parsing/validation stays in IngestEventHandler.
 */
public class InsightRelayHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final SqsClient sqsClient;
    private final String targetQueueUrl;

    public InsightRelayHandler() {
        this(SqsClient.builder().build());
    }

    public InsightRelayHandler(SqsClient sqsClient) {
        this.sqsClient = sqsClient;
        this.targetQueueUrl = System.getenv("FLOWFORGE_TARGET_QUEUE_URL");
    }

    @Override
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        String body = String.valueOf(event.get("body"));

        sqsClient.sendMessage(SendMessageRequest.builder()
                .queueUrl(targetQueueUrl)
                .messageBody(body)
                .build());

        return ProxyResponses.accepted("{\"relayed\":true}");
    }
}
