const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const COMMAND_LEDGER_TABLE = process.env.GREENHOUSEGUARD_COMMAND_LEDGER_TABLE;
const FAULTS_TABLE = process.env.GREENHOUSEGUARD_FAULTS_TABLE;

exports.handler = async (event) => {
  const zoneId = event.pathParameters.zoneId;

  const commandResult = await client.send(new QueryCommand({
    TableName: COMMAND_LEDGER_TABLE,
    KeyConditionExpression: 'zoneId = :zoneId',
    ExpressionAttributeValues: { ':zoneId': zoneId },
    ScanIndexForward: false,
    Limit: 1,
  }));

  const faultsResult = await client.send(new QueryCommand({
    TableName: FAULTS_TABLE,
    KeyConditionExpression: 'zoneId = :zoneId',
    ExpressionAttributeValues: { ':zoneId': zoneId },
  }));

  const latestCommand = (commandResult.Items && commandResult.Items[0]) || null;
  const faults = faultsResult.Items || [];

  return {
    statusCode: 200,
    body: JSON.stringify({ zoneId, latestCommand, faults }),
  };
};
