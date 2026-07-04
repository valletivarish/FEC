package binsight.backend.handlers;

import binsight.backend.support.ProxyResponses;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

import java.util.Map;

/**
 * API Gateway proxy target the fog dispatcher POSTs to. Deployed 3x behind 3 routes,
 * distinguished only by BINSIGHT_TARGET_QUEUE_URL at deploy time — the body is relayed
 * verbatim so all parsing/validation stays in the ingest handler on the SQS side.
 */
public class IngestRelayHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final SqsClient sqsClient;
    private final String targetQueueUrl;

    public IngestRelayHandler() {
        this(SqsClient.builder().build());
    }

    public IngestRelayHandler(SqsClient sqsClient) {
        this.sqsClient = sqsClient;
        this.targetQueueUrl = System.getenv("BINSIGHT_TARGET_QUEUE_URL");
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
