const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const client = new SQSClient({});

const INGEST_QUEUE_URL = process.env.GREENHOUSEGUARD_INGEST_QUEUE_URL;

// API Gateway has no direct SQS integration for this stack, so this Lambda's only job
// is forwarding the raw body onward — parsing/validation stays in ingestEvent, not here.
exports.handler = async (event) => {
  await client.send(new SendMessageCommand({
    QueueUrl: INGEST_QUEUE_URL,
    MessageBody: event.body,
  }));

  return {
    statusCode: 202,
    body: JSON.stringify({ accepted: true }),
  };
};
