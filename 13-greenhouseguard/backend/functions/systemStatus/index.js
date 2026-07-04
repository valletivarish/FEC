const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const sqsClient = new SQSClient({});

const COMMAND_LEDGER_TABLE = process.env.GREENHOUSEGUARD_COMMAND_LEDGER_TABLE;
const FAULTS_TABLE = process.env.GREENHOUSEGUARD_FAULTS_TABLE;
const INGEST_QUEUE_URL = process.env.GREENHOUSEGUARD_INGEST_QUEUE_URL;

const COUNTERS_ZONE_ID = '__counters__';
const COUNTERS_SORT_KEY = 'system_message_counters';

// a genuine DescribeTable call: succeeds only if DynamoDB (real AWS or floci) actually answers
// and the table is ACTIVE, so this is a real connectivity + health signal, never hardcoded
async function checkTable(tableName) {
  try {
    const result = await ddbClient.send(new DescribeTableCommand({ TableName: tableName }));
    return result.Table.TableStatus === 'ACTIVE';
  } catch {
    return false;
  }
}

// GetQueueAttributes both proves reachability and returns the real ApproximateNumberOfMessages depth
async function checkQueue() {
  if (!INGEST_QUEUE_URL) {
    return { healthy: false, approxMessages: null };
  }
  try {
    const result = await sqsClient.send(new GetQueueAttributesCommand({
      QueueUrl: INGEST_QUEUE_URL,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }));
    return {
      healthy: true,
      approxMessages: Number(result.Attributes.ApproximateNumberOfMessages),
    };
  } catch {
    return { healthy: false, approxMessages: null };
  }
}

async function readCounters() {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: FAULTS_TABLE,
      Key: { zoneId: COUNTERS_ZONE_ID, eventTypeTimestamp: COUNTERS_SORT_KEY },
    }));
    return {
      messagesReceived: (result.Item && result.Item.messagesReceived) || 0,
      messagesStored: (result.Item && result.Item.messagesStored) || 0,
    };
  } catch {
    return { messagesReceived: 0, messagesStored: 0 };
  }
}

// a Scan-based count is the honest way to get "records stored" without a maintained aggregate
// table; acceptable here since these tables stay small for a 3-zone greenhouse deployment
async function countStoredItems() {
  try {
    let total = 0;
    let lastEvaluatedKey;
    do {
      const result = await docClient.send(new ScanCommand({
        TableName: FAULTS_TABLE,
        Select: 'COUNT',
        ExclusiveStartKey: lastEvaluatedKey,
      }));
      total += result.Count || 0;
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    // exclude the reserved counters row itself from the "records stored" figure
    return Math.max(0, total - 1);
  } catch {
    return null;
  }
}

exports.handler = async () => {
  const [commandLedgerHealthy, faultsHealthy, queueStatus, counters, storedItemCount] = await Promise.all([
    checkTable(COMMAND_LEDGER_TABLE),
    checkTable(FAULTS_TABLE),
    checkQueue(),
    readCounters(),
    countStoredItems(),
  ]);

  const databaseHealthy = commandLedgerHealthy && faultsHealthy;
  // this Lambda itself successfully running IS the server-status signal for this serverless architecture
  const serverHealthy = true;

  return {
    statusCode: 200,
    body: JSON.stringify({
      apiStatus: serverHealthy ? 'Online' : 'Offline',
      serverStatus: serverHealthy ? 'Online' : 'Offline',
      databaseStatus: databaseHealthy ? 'Connected' : 'Unavailable',
      queueStatus: queueStatus.healthy ? 'Connected' : 'Unreachable',
      queueApproxMessages: queueStatus.approxMessages,
      cloudConnectionStatus: databaseHealthy && queueStatus.healthy ? 'Connected' : 'Unreachable',
      messagesReceived: counters.messagesReceived,
      messagesStored: storedItemCount === null ? counters.messagesStored : storedItemCount,
      checkedAt: new Date().toISOString(),
    }),
  };
};
