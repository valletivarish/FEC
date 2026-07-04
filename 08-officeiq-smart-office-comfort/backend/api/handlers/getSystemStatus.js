'use strict';

const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const sqsClient = new SQSClient({});

const TABLE_NAME = process.env.OFFICEIQ_READINGS_TABLE;
const QUEUE_URL = process.env.OFFICEIQ_EVENT_QUEUE_URL;

// Same reserved partition the worker writes to on every processed message (see ingestWorker.js)
const SYSTEM_COUNTERS_ZONE_ID = '__SYSTEM__';
const SYSTEM_COUNTERS_SORT_KEY = 'system_counters#totals';

// Real check: a live DescribeTable call, not a hardcoded string — ResourceNotFound/timeout means Unavailable
async function checkDatabase() {
  try {
    const result = await ddbClient.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    const tableStatus = result.Table && result.Table.TableStatus;
    return { status: tableStatus === 'ACTIVE' ? 'Connected' : 'Unavailable', tableStatus: tableStatus || null };
  } catch {
    return { status: 'Unavailable', tableStatus: null };
  }
}

// Real check: GetQueueAttributes succeeding is the queue health signal; ApproximateNumberOfMessages is real depth
async function checkQueue() {
  try {
    const result = await sqsClient.send(new GetQueueAttributesCommand({
      QueueUrl: QUEUE_URL,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }));
    return {
      status: 'Connected',
      approximateNumberOfMessages: Number((result.Attributes && result.Attributes.ApproximateNumberOfMessages) || 0),
    };
  } catch {
    return { status: 'Unavailable', approximateNumberOfMessages: null };
  }
}

// messagesReceived is a real running total the worker increments on every processed SQS message
async function getMessagesReceivedTotal() {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { zoneId: SYSTEM_COUNTERS_ZONE_ID, eventTypeTimestamp: SYSTEM_COUNTERS_SORT_KEY },
    }));
    return result.Item ? Number(result.Item.messagesReceived || 0) : 0;
  } catch {
    return null;
  }
}

// COUNT-only scan avoids paying to transfer every stored item's full payload just to know how
// many rows exist; excludes the reserved counters row so this reflects real sensor-derived events
async function getMessagesStoredTotal() {
  try {
    let totalCount = 0;
    let lastEvaluatedKey;
    do {
      const result = await docClient.send(new ScanCommand({
        TableName: TABLE_NAME,
        Select: 'COUNT',
        FilterExpression: 'zoneId <> :systemZone',
        ExpressionAttributeValues: { ':systemZone': SYSTEM_COUNTERS_ZONE_ID },
        ExclusiveStartKey: lastEvaluatedKey,
      }));
      totalCount += result.Count || 0;
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return totalCount;
  } catch {
    return null;
  }
}

exports.handler = async () => {
  const [database, queue, messagesReceived, messagesStored] = await Promise.all([
    checkDatabase(),
    checkQueue(),
    getMessagesReceivedTotal(),
    getMessagesStoredTotal(),
  ]);

  // API/server status is this Lambda invocation succeeding at all — reaching this line proves it's live
  const cloudConnection = database.status === 'Connected' && queue.status === 'Connected' ? 'Connected' : 'Unreachable';

  return {
    statusCode: 200,
    body: JSON.stringify({
      apiStatus: 'Online',
      serverStatus: 'Online',
      cloudConnection,
      database,
      queue,
      messagesReceived,
      messagesStored,
    }),
  };
};

module.exports.checkDatabase = checkDatabase;
module.exports.checkQueue = checkQueue;
module.exports.getMessagesReceivedTotal = getMessagesReceivedTotal;
module.exports.getMessagesStoredTotal = getMessagesStoredTotal;
module.exports.SYSTEM_COUNTERS_ZONE_ID = SYSTEM_COUNTERS_ZONE_ID;
module.exports.SYSTEM_COUNTERS_SORT_KEY = SYSTEM_COUNTERS_SORT_KEY;
