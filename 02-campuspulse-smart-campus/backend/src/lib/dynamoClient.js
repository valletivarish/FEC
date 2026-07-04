'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// No endpoint override here - AWS_ENDPOINT_URL in env covers local dev,
// and is simply absent in real deployments.
const baseClient = new DynamoDBClient({});

const docClient = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: { removeUndefinedValues: true },
});

module.exports = { docClient };
