'use strict';

const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamoClient');
const { ok, serverError } = require('../lib/responses');

const ALERTS_TABLE = process.env.CAMPUSPULSE_ALERTS_TABLE || 'CampusPulseAlerts';

exports.handler = async () => {
  try {
    // A Scan is fine at this scale; a GSI on severity/expiresAt would replace it at larger scale.
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    const result = await docClient.send(
      new ScanCommand({
        TableName: ALERTS_TABLE,
        FilterExpression: 'expiresAt > :now',
        ExpressionAttributeValues: { ':now': nowEpochSeconds },
      })
    );

    return ok({ alerts: result.Items || [] });
  } catch (err) {
    console.error('activeAlertsHandler failed', err);
    return serverError('Failed to fetch active alerts');
  }
};
