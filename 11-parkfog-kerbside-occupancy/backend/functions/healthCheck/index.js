const { DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { GetQueueAttributesCommand, SQSClient } = require('@aws-sdk/client-sqs');
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, ddbClient } = require('../../lib/dynamoClient');
const { COUNTERS_ENTITY_ID, COUNTERS_SORT_KEY } = require('../../lib/counters');

const TABLE_NAME = process.env.PARKFOG_EVENTS_TABLE;
const QUEUE_URL = process.env.PARKFOG_BAY_EVENTS_QUEUE_URL;

// useQueueUrlAsEndpoint:false: default SQS behaviour derives the request host from the queue
// URL string itself, which only matches the deploying machine's view of "localhost", not the
// separate network namespace Lambda actually executes in against a local emulator
const sqsClient = new SQSClient({ useQueueUrlAsEndpoint: false });

// real DescribeTable round-trip proves both DynamoDB reachability and that the table exists
async function checkDatabase() {
  try {
    const result = await ddbClient.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    const status = result.Table && result.Table.TableStatus;
    return { status: status === 'ACTIVE' ? 'Connected' : 'Unavailable', tableStatus: status || 'UNKNOWN' };
  } catch (err) {
    return { status: 'Unavailable', error: err.message };
  }
}

// GetQueueAttributes both proves SQS reachability and returns the real in-flight depth
async function checkQueue() {
  try {
    const result = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: QUEUE_URL,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      })
    );
    const attrs = result.Attributes || {};
    return {
      status: 'Connected',
      approximateNumberOfMessages: Number(attrs.ApproximateNumberOfMessages || 0),
      approximateNumberOfMessagesInFlight: Number(attrs.ApproximateNumberOfMessagesNotVisible || 0),
    };
  } catch (err) {
    return { status: 'Unavailable', error: err.message };
  }
}

async function readCounters() {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { entityId: COUNTERS_ENTITY_ID, eventTypeTimestamp: COUNTERS_SORT_KEY },
      })
    );
    const item = result.Item || {};
    return {
      receivedCount: item.receivedCount || 0,
      storedCount: item.storedCount || 0,
    };
  } catch {
    return { receivedCount: 0, storedCount: 0 };
  }
}

exports.handler = async () => {
  const [database, queue, counters] = await Promise.all([
    checkDatabase(),
    checkQueue(),
    readCounters(),
  ]);

  // this handler running at all, invoked through API Gateway, is itself the server-status signal
  const server = { status: 'Running' };
  const cloudConnection = database.status === 'Connected' && queue.status === 'Connected' ? 'Connected' : 'Unreachable';
  const api = { status: 'Online' };

  const overallHealthy = database.status === 'Connected' && queue.status === 'Connected';

  return {
    statusCode: overallHealthy ? 200 : 503,
    body: JSON.stringify({
      api,
      database,
      queue,
      server,
      cloudConnection,
      messagesReceived: counters.receivedCount,
      messagesStored: counters.storedCount,
      checkedAt: new Date().toISOString(),
    }),
  };
};
