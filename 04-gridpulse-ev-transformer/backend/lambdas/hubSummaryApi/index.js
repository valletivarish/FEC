const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const READINGS_TABLE = process.env.GRIDPULSE_READINGS_TABLE;
const CURTAILMENT_TABLE = process.env.GRIDPULSE_CURTAILMENT_TABLE;

// bay_setpoint items share the hub partition, so the latest per bayId must be picked client-side
function latestPerBay(items) {
  const latestByBay = new Map();
  for (const item of items) {
    const existing = latestByBay.get(item.bayId);
    if (!existing || item.timestamp > existing.timestamp) {
      latestByBay.set(item.bayId, item);
    }
  }
  return Array.from(latestByBay.values());
}

exports.handler = async (event) => {
  const hubId = event && event.pathParameters && event.pathParameters.hubId;
  if (!hubId) {
    return { statusCode: 400, body: JSON.stringify({ message: 'hubId path parameter is required' }) };
  }

  const readingsResult = await docClient.send(new QueryCommand({
    TableName: READINGS_TABLE,
    KeyConditionExpression: 'hubId = :hubId',
    ExpressionAttributeValues: { ':hubId': hubId },
  }));
  const readingItems = readingsResult.Items || [];

  const bayItems = readingItems.filter((item) => item.type === 'bay_setpoint');
  const derItems = readingItems.filter((item) => item.type === 'der_mode' || item.type === 'der_summary');

  const bays = latestPerBay(bayItems);
  const latestDer = derItems.reduce((latest, item) => (
    !latest || item.timestamp > latest.timestamp ? item : latest
  ), null);

  const curtailmentResult = await docClient.send(new QueryCommand({
    TableName: CURTAILMENT_TABLE,
    KeyConditionExpression: 'hubId = :hubId',
    ExpressionAttributeValues: { ':hubId': hubId },
    ScanIndexForward: false,
    Limit: 1,
  }));
  const latestCurtailment = (curtailmentResult.Items || [])[0] || null;

  return {
    statusCode: 200,
    body: JSON.stringify({
      hubId,
      bays,
      der: latestDer,
      curtailment: latestCurtailment,
    }),
  };
};
