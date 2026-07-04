package ie.nci.flowforge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageResponse;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InsightRelayHandlerTest {

    @Mock
    private SqsClient sqsClient;

    @Mock
    private Context context;

    private InsightRelayHandler handler;

    @BeforeEach
    void setUp() {
        handler = new InsightRelayHandler(sqsClient);
    }

    @Test
    void relaysRawBodyToConfiguredQueueAndReturns202() {
        when(sqsClient.sendMessage(any(SendMessageRequest.class))).thenReturn(SendMessageResponse.builder().build());

        String rawBody = "{\"type\":\"mad_anomaly\",\"pumpId\":\"pump-01\",\"trigger\":\"mad_anomaly\"}";
        Map<String, Object> event = Map.of("body", rawBody);

        Map<String, Object> response = handler.handleRequest(event, context);

        ArgumentCaptor<SendMessageRequest> captor = ArgumentCaptor.forClass(SendMessageRequest.class);
        verify(sqsClient).sendMessage(captor.capture());
        assertEquals(rawBody, captor.getValue().messageBody());

        assertEquals(202, response.get("statusCode"));
        assertEquals("{\"relayed\":true}", response.get("body"));
    }
}
