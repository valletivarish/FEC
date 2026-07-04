'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

// no region/endpoint hardcoded - SDK reads AWS_ENDPOINT_URL/AWS_REGION from env for local vs real AWS parity
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
// useQueueUrlAsEndpoint defaults true, which would silently swap in the queue URL's own host
// and ignore AWS_ENDPOINT_URL - fine on real AWS where they match, not fine behind a local proxy
const sqsClient = new SQSClient({ useQueueUrlAsEndpoint: false });

const TABLE_NAME = process.env.OFFICEIQ_READINGS_TABLE;
const QUEUE_URL = process.env.OFFICEIQ_EVENT_QUEUE_URL;

// same table, a reserved zoneId partition the dashboard's status handler reads back as a
// real running total — avoids a second table just to count messages the backend has ingested
const SYSTEM_COUNTERS_ZONE_ID = '__SYSTEM__';
const SYSTEM_COUNTERS_SORT_KEY = 'system_counters#totals';

async function incrementReceivedCounter() {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { zoneId: SYSTEM_COUNTERS_ZONE_ID, eventTypeTimestamp: SYSTEM_COUNTERS_SORT_KEY },
    UpdateExpression: 'ADD messagesReceived :one',
    ExpressionAttributeValues: { ':one': 1 },
  }));
}

// sqsMessageBody is already-JSON-parsed; composite sort key groups by event type then time for range queries
async function processMessage(sqsMessageBody) {
  const { type, zoneId, timestamp } = sqsMessageBody;
  const item = {
    zoneId,
    eventTypeTimestamp: `${type}#${timestamp}`,
    ...sqsMessageBody,
  };

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  }));
  await incrementReceivedCounter();

  return item;
}

// long-polling loop that actually runs inside the Fargate task
async function runWorkerLoop() {
  for (;;) {
    const received = await sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
    }));

    const messages = received.Messages || [];
    for (const message of messages) {
      const body = JSON.parse(message.Body);
      await processMessage(body);
      await sqsClient.send(new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
      }));
    }
  }
}

module.exports = { processMessage, runWorkerLoop, SYSTEM_COUNTERS_ZONE_ID, SYSTEM_COUNTERS_SORT_KEY };

// only auto-start the loop when run as the container entrypoint, not when required by tests
if (require.main === module) {
  runWorkerLoop();
}
