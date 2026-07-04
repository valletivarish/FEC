const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { KinesisClient, DescribeStreamSummaryCommand } = require('@aws-sdk/client-kinesis');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const kinesisClient = new KinesisClient({});

const READINGS_TABLE = process.env.GRIDPULSE_READINGS_TABLE;
const CURTAILMENT_TABLE = process.env.GRIDPULSE_CURTAILMENT_TABLE;
const OPS_COUNTERS_TABLE = process.env.GRIDPULSE_OPS_COUNTERS_TABLE;
const STREAM_NAME = process.env.GRIDPULSE_STREAM_NAME;
const OPS_COUNTERS_ID = 'gridpulse-backend';

// DescribeTable succeeding is a real connectivity + existence check, not a hardcoded string
async function checkTable(tableName) {
  try {
    await ddbClient.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (err) {
    console.error(`healthApi: DescribeTable failed for ${tableName}`, err.message);
    return false;
  }
}

async function checkStream() {
  try {
    await kinesisClient.send(new DescribeStreamSummaryCommand({ StreamName: STREAM_NAME }));
    return true;
  } catch (err) {
    console.error('healthApi: DescribeStreamSummary failed', err.message);
    return false;
  }
}

async function readCounters() {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: OPS_COUNTERS_TABLE,
      Key: { counterId: OPS_COUNTERS_ID },
    }));
    return {
      messagesReceived: result.Item?.messagesReceived ?? 0,
      messagesStored: result.Item?.messagesStored ?? 0,
    };
  } catch (err) {
    console.error('healthApi: failed to read ops counters', err.message);
    return { messagesReceived: 0, messagesStored: 0 };
  }
}

// approximate live record count via a paginated scan — fine at this project's data volume,
// and gives a real "messages stored" figure independent of the counter item in case it drifts
async function countStoredRecords() {
  let count = 0;
  let lastKey;
  try {
    do {
      const result = await docClient.send(new ScanCommand({
        TableName: READINGS_TABLE,
        Select: 'COUNT',
        ExclusiveStartKey: lastKey,
      }));
      count += result.Count ?? 0;
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return count;
  } catch (err) {
    console.error('healthApi: failed to scan readings table for count', err.message);
    return null;
  }
}

exports.handler = async () => {
  const [readingsUp, curtailmentUp, streamUp, counters, scannedCount] = await Promise.all([
    checkTable(READINGS_TABLE),
    checkTable(CURTAILMENT_TABLE),
    checkStream(),
    readCounters(),
    countStoredRecords(),
  ]);

  const databaseUp = readingsUp && curtailmentUp;

  return {
    statusCode: 200,
    body: JSON.stringify({
      apiStatus: 'reachable',
      database: databaseUp ? 'connected' : 'unavailable',
      queue: streamUp ? 'connected' : 'unavailable',
      cloudConnection: databaseUp && streamUp ? 'connected' : 'unreachable',
      server: 'running',
      messagesReceived: counters.messagesReceived,
      messagesStored: scannedCount ?? counters.messagesStored,
      checkedAt: new Date().toISOString(),
    }),
  };
};
