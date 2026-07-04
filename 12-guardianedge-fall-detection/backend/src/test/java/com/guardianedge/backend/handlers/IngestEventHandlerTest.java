package com.guardianedge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;
import software.amazon.awssdk.services.dynamodb.model.PutItemResponse;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemResponse;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IngestEventHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private IngestEventHandler handler;

    @BeforeEach
    void setUp() {
        lenient().when(context.getLogger()).thenReturn(logger);
        when(dynamoDbClient.putItem(any(PutItemRequest.class)))
                .thenReturn(PutItemResponse.builder().build());
        when(dynamoDbClient.updateItem(any(UpdateItemRequest.class)))
                .thenReturn(UpdateItemResponse.builder().build());
        handler = new IngestEventHandler(dynamoDbClient);
    }

    private Map<String, Object> sqsEvent(String... bodies) {
        List<Map<String, Object>> records = new ArrayList<>();
        for (String body : bodies) {
            records.add(Map.of("body", body));
        }
        return Map.of("Records", records);
    }

    @Test
    void writesHistoryItemWithCompositeSortKey() {
        String body = "{\"residentId\":\"resident-01\",\"type\":\"fall_event\","
                + "\"state\":\"FALL_CONFIRMED\",\"accelMagnitude\":120.5,"
                + "\"timestamp\":\"2026-07-02T10:15:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient).putItem(captor.capture());

        PutItemRequest request = captor.getValue();
        Map<String, AttributeValue> item = request.item();
        assertEquals("resident-01", item.get("residentId").s());
        assertEquals("fall_event#2026-07-02T10:15:00Z", item.get("eventTypeTimestamp").s());
        assertTrue(item.containsKey("ttlEpochSeconds"));
    }

    @Test
    void fallEventSetsCurrentRiskStateToCritical() {
        String body = "{\"residentId\":\"resident-02\",\"type\":\"fall_event\","
                + "\"state\":\"FALL_CONFIRMED\",\"accelMagnitude\":130.0,"
                + "\"timestamp\":\"2026-07-02T11:00:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());

        UpdateItemRequest request = captor.getValue();
        assertEquals("CRITICAL", request.expressionAttributeValues().get(":currentRiskState").s());
        assertTrue(request.updateExpression().contains("#currentRiskState"));
    }

    @Test
    void vitalsEventUsesNewStateDirectlyAsRiskState() {
        String body = "{\"residentId\":\"resident-03\",\"type\":\"vitals_event\",\"vital\":\"heartrate\","
                + "\"previousState\":\"NORMAL\",\"newState\":\"WARNING\",\"value\":135,"
                + "\"sdnnMs\":null,\"timestamp\":\"2026-07-02T12:00:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());

        assertEquals("WARNING", captor.getValue().expressionAttributeValues().get(":currentRiskState").s());
    }

    @Test
    void presenceEventLeavesCurrentRiskStateUntouched() {
        String body = "{\"residentId\":\"resident-01\",\"type\":\"presence_event\",\"state\":\"OCCUPIED\","
                + "\"timestamp\":\"2026-07-02T13:00:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());

        UpdateItemRequest request = captor.getValue();
        assertTrue(!request.updateExpression().contains("#currentRiskState"));
        assertEquals("presence_event", request.expressionAttributeValues().get(":latestEventType").s());
    }

    @Test
    void oneMalformedRecordDoesNotCrashTheBatch() {
        String goodBody = "{\"residentId\":\"resident-01\",\"type\":\"comfort_event\",\"issue\":\"temperature\","
                + "\"timestamp\":\"2026-07-02T14:00:00Z\"}";
        String malformedBody = "{not-json";

        handler.handleRequest(sqsEvent(malformedBody, goodBody), context);

        verify(dynamoDbClient).putItem(any(PutItemRequest.class));
        verify(dynamoDbClient).updateItem(any(UpdateItemRequest.class));
    }
}
