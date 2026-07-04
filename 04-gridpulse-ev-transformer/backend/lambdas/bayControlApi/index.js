const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const READINGS_TABLE = process.env.GRIDPULSE_READINGS_TABLE;

// dashboard roster needs one current row per bay, not the full change history
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

  // SK prefix scopes the query to bay_setpoint history only, naturally ordered oldest to newest
  const result = await docClient.send(new QueryCommand({
    TableName: READINGS_TABLE,
    KeyConditionExpression: 'hubId = :hubId AND begins_with(#sk, :prefix)',
    ExpressionAttributeNames: { '#sk': 'metricType#timestamp' },
    ExpressionAttributeValues: {
      ':hubId': hubId,
      ':prefix': 'bay_setpoint#',
    },
  }));

  const bays = latestPerBay(result.Items || []);

  return {
    statusCode: 200,
    body: JSON.stringify(bays),
  };
};
