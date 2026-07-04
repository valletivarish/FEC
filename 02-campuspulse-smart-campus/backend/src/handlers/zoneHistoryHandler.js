'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamoClient');
const { ok, badRequest, serverError } = require('../lib/responses');

const READINGS_TABLE = process.env.CAMPUSPULSE_READINGS_TABLE || 'CampusPulseReadings';
const ALERTS_TABLE = process.env.CAMPUSPULSE_ALERTS_TABLE || 'CampusPulseAlerts';

exports.handler = async (event) => {
  const zoneId = event.pathParameters && event.pathParameters.zoneId;
  if (!zoneId) {
    return badRequest('zoneId path parameter is required');
  }

  const topic = event.queryStringParameters && event.queryStringParameters.topic;

  const readingsParams = {
    TableName: READINGS_TABLE,
    KeyConditionExpression: 'zoneId = :zoneId',
    ExpressionAttributeValues: { ':zoneId': zoneId },
    ScanIndexForward: true,
  };

  // sensorTimestamp is "{topic}#{isoTimestamp}", so a topic filter is a begins_with on the sort key.
  if (topic) {
    readingsParams.KeyConditionExpression += ' AND begins_with(sensorTimestamp, :topicPrefix)';
    readingsParams.ExpressionAttributeValues[':topicPrefix'] = `${topic}#`;
  }

  // Alerts have no topic attribute, so unlike readings they are never topic-filtered here -
  // callers (e.g. energyPanelView) filter the returned events by eventType instead.
  const alertsParams = {
    TableName: ALERTS_TABLE,
    KeyConditionExpression: 'zoneId = :zoneId',
    ExpressionAttributeValues: { ':zoneId': zoneId },
    ScanIndexForward: true,
  };

  try {
    const [readingsResult, alertsResult] = await Promise.all([
      docClient.send(new QueryCommand(readingsParams)),
      docClient.send(new QueryCommand(alertsParams)),
    ]);
    return ok({
      zoneId,
      topic: topic || null,
      readings: readingsResult.Items || [],
      events: alertsResult.Items || [],
    });
  } catch (err) {
    console.error('zoneHistoryHandler failed', err);
    return serverError('Failed to fetch zone history');
  }
};
