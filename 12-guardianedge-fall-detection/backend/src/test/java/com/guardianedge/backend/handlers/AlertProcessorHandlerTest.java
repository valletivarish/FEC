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
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemResponse;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AlertProcessorHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private AlertProcessorHandler handler;

    @BeforeEach
    void setUp() {
        lenient().when(context.getLogger()).thenReturn(logger);
        lenient().when(dynamoDbClient.updateItem(any(UpdateItemRequest.class)))
                .thenReturn(UpdateItemResponse.builder().build());
        handler = new AlertProcessorHandler(dynamoDbClient);
    }

    private Map<String, Object> strAttr(String value) {
        return Map.of("S", value);
    }

    private Map<String, Object> newImage(String residentId, String type, String newState) {
        java.util.HashMap<String, Object> image = new java.util.HashMap<>();
        image.put("residentId", strAttr(residentId));
        image.put("type", strAttr(type));
        if (newState != null) {
            image.put("newState", strAttr(newState));
        }
        return image;
    }

    private Map<String, Object> insertRecord(String residentId, String type, String newState) {
        return Map.of(
                "eventName", "INSERT",
                "dynamodb", Map.of("NewImage", newImage(residentId, type, newState))
        );
    }

    @Test
    void fallEventIncrementsActiveCriticalAlertCount() {
        Map<String, Object> event = Map.of("Records",
                List.of(insertRecord("resident-01", "fall_event", null)));

        handler.handleRequest(event, context);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());
        assertEquals("resident-01", captor.getValue().key().get("residentId").s());
    }

    @Test
    void vitalsEventCriticalIncrementsCount() {
        Map<String, Object> event = Map.of("Records",
                List.of(insertRecord("resident-02", "vitals_event", "CRITICAL")));

        handler.handleRequest(event, context);

        verify(dynamoDbClient, times(1)).updateItem(any(UpdateItemRequest.class));
    }

    @Test
    void vitalsEventWarningIsIgnored() {
        Map<String, Object> event = Map.of("Records",
                List.of(insertRecord("resident-02", "vitals_event", "WARNING")));

        handler.handleRequest(event, context);

        verify(dynamoDbClient, never()).updateItem(any(UpdateItemRequest.class));
    }

    @Test
    void inactivityAlertIncrementsCount() {
        Map<String, Object> event = Map.of("Records",
                List.of(insertRecord("resident-03", "inactivity_alert", null)));

        handler.handleRequest(event, context);

        verify(dynamoDbClient, times(1)).updateItem(any(UpdateItemRequest.class));
    }

    @Test
    void presenceAndComfortEventsAreIgnored() {
        Map<String, Object> event = Map.of("Records", List.of(
                insertRecord("resident-01", "presence_event", null),
                insertRecord("resident-01", "comfort_event", null)
        ));

        handler.handleRequest(event, context);

        verify(dynamoDbClient, never()).updateItem(any(UpdateItemRequest.class));
    }

    @Test
    void nonInsertEventNamesAreIgnored() {
        Map<String, Object> record = Map.of(
                "eventName", "MODIFY",
                "dynamodb", Map.of("NewImage", newImage("resident-01", "fall_event", null))
        );
        Map<String, Object> event = Map.of("Records", List.of(record));

        handler.handleRequest(event, context);

        verify(dynamoDbClient, never()).updateItem(any(UpdateItemRequest.class));
    }
}
