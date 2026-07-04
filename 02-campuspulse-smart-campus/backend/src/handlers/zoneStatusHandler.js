'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamoClient');
const { ok, notFound, badRequest, serverError } = require('../lib/responses');

const READINGS_TABLE = process.env.CAMPUSPULSE_READINGS_TABLE || 'CampusPulseReadings';
const ALERTS_TABLE = process.env.CAMPUSPULSE_ALERTS_TABLE || 'CampusPulseAlerts';

// Zone status is a comfort snapshot, not a raw feed - only these topics render on the
// dashboard grid/comfort panel, each mapped to the flat field name callers read.
const STATUS_TOPICS = [
  { topic: 'temperature', field: 'temperature' },
  { topic: 'humidity', field: 'humidity' },
  { topic: 'co2', field: 'co2' },
  { topic: 'light-lux', field: 'lightLux' },
];

// Readings share one sort key per zone across all topics, so the latest row overall is
// rarely the latest of any single topic - query each topic's own begins_with prefix instead.
async function latestReadingForTopic(zoneId, topic) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: READINGS_TABLE,
      KeyConditionExpression: 'zoneId = :zoneId AND begins_with(sensorTimestamp, :topicPrefix)',
      ExpressionAttributeValues: { ':zoneId': zoneId, ':topicPrefix': `${topic}#` },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  return (result.Items && result.Items[0]) || null;
}

async function latestStatusFields(zoneId) {
  const readings = await Promise.all(
    STATUS_TOPICS.map(({ topic }) => latestReadingForTopic(zoneId, topic))
  );
  const fields = {};
  let mostRecent = null;
  readings.forEach((reading, index) => {
    const { field } = STATUS_TOPICS[index];
    fields[field] = reading ? reading.value : null;
    if (reading && (!mostRecent || reading.timestamp > mostRecent.timestamp)) {
      mostRecent = reading;
    }
  });
  return { fields, mostRecent };
}

async function latestAlert(zoneId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ALERTS_TABLE,
      KeyConditionExpression: 'zoneId = :zoneId',
      ExpressionAttributeValues: { ':zoneId': zoneId },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  return (result.Items && result.Items[0]) || null;
}

exports.handler = async (event) => {
  const zoneId = event.pathParameters && event.pathParameters.zoneId;
  if (!zoneId) {
    return badRequest('zoneId path parameter is required');
  }

  try {
    const [{ fields, mostRecent }, alert] = await Promise.all([
      latestStatusFields(zoneId),
      latestAlert(zoneId),
    ]);

    if (!mostRecent && !alert) {
      return notFound(`No data found for zone ${zoneId}`);
    }

    return ok({ zoneId, ...fields, latestReading: mostRecent, latestAlert: alert });
  } catch (err) {
    console.error('zoneStatusHandler failed', err);
    return serverError('Failed to fetch zone status');
  }
};
