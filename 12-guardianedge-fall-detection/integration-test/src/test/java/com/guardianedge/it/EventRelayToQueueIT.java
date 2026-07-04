package com.guardianedge.it;

// Proves the HTTP-facing relay Lambda actually lands the fog dispatcher's POST body on SQS,
// closing the gap where only in-process Lambda calls (bypassing HTTP/API-Gateway/SQS) were proven.

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.guardianedge.backend.handlers.EventRelayHandler;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.CreateQueueRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import software.amazon.awssdk.services.sqs.model.QueueDoesNotExistException;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EventRelayToQueueIT {

    private static final String QUEUE_NAME = "guardianedge-relay-it-queue.fifo";
    private static final SqsClient SQS = SqsClient.builder().build();
    private static String queueUrl;

    @BeforeAll
    static void ensureQueue() {
        try {
            queueUrl = SQS.getQueueUrl(b -> b.queueName(QUEUE_NAME)).queueUrl();
        } catch (QueueDoesNotExistException e) {
            queueUrl = SQS.createQueue(CreateQueueRequest.builder()
                    .queueName(QUEUE_NAME)
                    .attributes(Map.of(
                            QueueAttributeName.FIFO_QUEUE, "true",
                            QueueAttributeName.CONTENT_BASED_DEDUPLICATION, "true"))
                    .build()).queueUrl();
        }
    }

    private static Context mockContext() {
        LambdaLogger logger = Mockito.mock(LambdaLogger.class);
        Context context = Mockito.mock(Context.class);
        Mockito.lenient().when(context.getLogger()).thenReturn(logger);
        Mockito.lenient().when(context.getAwsRequestId()).thenReturn("it-request-1");
        return context;
    }

    @Test
    void a_post_shaped_invocation_lands_the_raw_body_on_the_real_queue() {
        String body = "{\"type\":\"fall_event\",\"residentId\":\"resident-relay-it\","
                + "\"state\":\"FALL_CONFIRMED\",\"timestamp\":\"2026-07-03T09:00:03.000Z\"}";
        Map<String, Object> apiGatewayEvent = Map.of(
                "routeKey", "POST /events",
                "rawPath", "/events",
                "body", body);

        EventRelayHandler handler = new EventRelayHandler(SQS, queueUrl);
        Map<String, Object> response = handler.handleRequest(apiGatewayEvent, mockContext());
        assertEquals(202, response.get("statusCode"));

        var received = SQS.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(queueUrl)
                .maxNumberOfMessages(1)
                .waitTimeSeconds(5)
                .build());

        assertTrue(received.hasMessages(), "expected the relayed message to have landed on the queue");
        Message message = received.messages().get(0);
        assertEquals(body, message.body());

        SQS.deleteMessage(b -> b.queueUrl(queueUrl).receiptHandle(message.receiptHandle()));
    }
}
