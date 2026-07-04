const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

// useQueueUrlAsEndpoint:false: default SQS behaviour derives the request host from the queue
// URL string itself, which only matches the deploying machine's view of "localhost", not the
// separate network namespace Lambda actually executes in against a local emulator
const sqsClient = new SQSClient({ useQueueUrlAsEndpoint: false });

const QUEUE_URL = process.env.PARKFOG_BAY_EVENTS_QUEUE_URL;

// fronts the queue so fog nodes can POST over HTTP; forwards the raw body, ingestBayEvents does the parsing
exports.handler = async (event) => {
  const body = (event && event.body) || '';

  await sqsClient.send(
    new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: body })
  );

  return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
};
