'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.OFFICEIQ_READINGS_TABLE;
const DEFAULT_LIMIT = 50;

exports.handler = async (event) => {
  const zoneId = event.pathParameters && event.pathParameters.zoneId;

  if (!zoneId) {
    return { statusCode: 400, body: JSON.stringify({ message: 'zoneId is required' }) };
  }

  const queryParams = (event.queryStringParameters || {});
  const limit = Number(queryParams.limit) || DEFAULT_LIMIT;

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'zoneId = :zoneId',
    ExpressionAttributeValues: { ':zoneId': zoneId },
    ScanIndexForward: false,
    Limit: limit,
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      zoneId,
      count: (result.Items || []).length,
      events: result.Items || [],
    }),
  };
};
