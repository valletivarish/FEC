const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const FAULTS_TABLE = process.env.GREENHOUSEGUARD_FAULTS_TABLE;

exports.handler = async (event) => {
  const zoneId = event.pathParameters.zoneId;
  const { eventTypeTimestamp } = JSON.parse(event.body);

  const result = await client.send(new UpdateCommand({
    TableName: FAULTS_TABLE,
    Key: { zoneId, eventTypeTimestamp },
    UpdateExpression: 'SET acknowledged = :acknowledged',
    ExpressionAttributeValues: { ':acknowledged': true },
    ReturnValues: 'ALL_NEW',
  }));

  return {
    statusCode: 200,
    body: JSON.stringify(result.Attributes),
  };
};
