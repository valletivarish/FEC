package edu.msc.floodwatch.it;

import com.amazonaws.services.lambda.runtime.Context;
import com.fasterxml.jackson.databind.ObjectMapper;
import edu.msc.floodwatch.backend.ingest.ReachEventRelayHandler;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.CreateQueueRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueDoesNotExistException;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the API-Gateway-facing relay actually reaches SQS: a POST-shaped proxy event goes
 * into the real handler and the raw body must come back out via SQS ReceiveMessage on floci.
 */
class ReachEventRelayIT {

    private static final String QUEUE_NAME = "floodwatch-relay-it-queue";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static SqsClient sqsClient;
    private static String queueUrl;

    @BeforeAll
    static void ensureQueue() {
        sqsClient = SqsClient.builder().build();
        try {
            queueUrl = sqsClient.getQueueUrl(b -> b.queueName(QUEUE_NAME)).queueUrl();
        } catch (QueueDoesNotExistException notYetCreated) {
            queueUrl = sqsClient.createQueue(CreateQueueRequest.builder()
                    .queueName(QUEUE_NAME)
                    .build()).queueUrl();
        }
    }

    @Test
    void aPostShapedInvocationLandsTheRawBodyOnTheIntakeQueue() throws Exception {
        ReachEventRelayHandler handler = new ReachEventRelayHandler(sqsClient, queueUrl);
        Context context = Mockito.mock(Context.class);

        Map<String, Object> reachEvent = Map.of(
                "reachId", "reach-it-relay",
                "type", "hydro_event",
                "stage", "AMBER",
                "timestamp", java.time.Instant.now().toString());
        String rawBody = MAPPER.writeValueAsString(reachEvent);

        Map<String, Object> apiGatewayProxyEvent = Map.of(
                "routeKey", "POST /events",
                "rawPath", "/events",
                "body", rawBody);

        Map<String, Object> response = handler.handleRequest(apiGatewayProxyEvent, context);
        assertEquals(202, response.get("statusCode"));

        ReceiveMessageResponse received = sqsClient.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(queueUrl)
                .waitTimeSeconds(5)
                .maxNumberOfMessages(1)
                .build());

        List<Message> messages = received.messages();
        assertTrue(messages.size() >= 1, "expected the relayed message to land on the queue");
        assertEquals(rawBody, messages.get(0).body());

        sqsClient.deleteMessage(b -> b.queueUrl(queueUrl).receiptHandle(messages.get(0).receiptHandle()));
    }
}
