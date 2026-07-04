package binsight.backend.handlers;

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
class IngestRelayHandlerTest {

    @Mock
    private SqsClient sqsClient;

    @Mock
    private Context context;

    private IngestRelayHandler handler;

    @BeforeEach
    void setUp() {
        handler = new IngestRelayHandler(sqsClient);
    }

    @Test
    void relaysRawBodyToConfiguredQueueAndReturns202() throws Exception {
        when(sqsClient.sendMessage(any(SendMessageRequest.class))).thenReturn(SendMessageResponse.builder().build());

        String rawBody = "{\"type\":\"cluster_verdict\",\"binId\":\"bin-01\",\"verdict\":\"INCONSISTENT\"}";
        Map<String, Object> event = Map.of("body", rawBody);

        Map<String, Object> response = handler.handleRequest(event, context);

        ArgumentCaptor<SendMessageRequest> captor = ArgumentCaptor.forClass(SendMessageRequest.class);
        verify(sqsClient).sendMessage(captor.capture());
        assertEquals(rawBody, captor.getValue().messageBody());

        assertEquals(202, response.get("statusCode"));
        assertEquals("{\"relayed\":true}", response.get("body"));
    }
}
