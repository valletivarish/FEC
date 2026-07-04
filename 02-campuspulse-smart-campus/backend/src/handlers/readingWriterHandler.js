'use strict';

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamoClient');
const { incrementCounter } = require('../lib/counters');

const READINGS_TABLE = process.env.CAMPUSPULSE_READINGS_TABLE || 'CampusPulseReadings';
const ALERTS_TABLE = process.env.CAMPUSPULSE_ALERTS_TABLE || 'CampusPulseAlerts';
const ALERT_TTL_SECONDS = 30 * 24 * 60 * 60;

// Fog events carry eventType; raw sensor readings never do - that alone tells them apart.
function isFogEvent(parsed) {
  return typeof parsed === 'object' && parsed !== null && typeof parsed.eventType === 'string';
}

async function writeReading(reading) {
  const item = {
    zoneId: reading.zoneId,
    sensorTimestamp: `${reading.topic}#${reading.timestamp}`,
    topic: reading.topic,
    value: reading.value,
    timestamp: reading.timestamp,
  };
  await docClient.send(new PutCommand({ TableName: READINGS_TABLE, Item: item }));
}

async function writeFogEvent(fogEvent) {
  // Only WARN/BREACH are persisted as alerts - INFO events are not actionable.
  if (fogEvent.severity !== 'WARN' && fogEvent.severity !== 'BREACH') {
    return;
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ALERT_TTL_SECONDS;
  const item = {
    zoneId: fogEvent.zoneId,
    alertTimestamp: `${fogEvent.eventType}#${fogEvent.timestamp}`,
    eventType: fogEvent.eventType,
    severity: fogEvent.severity,
    payload: fogEvent.payload || {},
    timestamp: fogEvent.timestamp,
    expiresAt,
  };
  await docClient.send(new PutCommand({ TableName: ALERTS_TABLE, Item: item }));
}

// A message body may be a single fog event, or a batch (array) of raw readings.
async function processMessageBody(parsed) {
  if (Array.isArray(parsed)) {
    for (const reading of parsed) {
      await writeReading(reading);
    }
    return;
  }
  if (isFogEvent(parsed)) {
    await writeFogEvent(parsed);
    return;
  }
  await writeReading(parsed);
}

exports.handler = async (event) => {
  const records = (event && event.Records) || [];

  for (const record of records) {
    try {
      const parsed = JSON.parse(record.body);
      await processMessageBody(parsed);
      // Counts once per SQS message actually ingested from a fog node/sensor batch -
      // mirrors the fog dispatcher's own "messages sent" counter on the other side of the wire.
      await incrementCounter('messagesReceived').catch((err) => {
        console.error('Failed to increment messagesReceived counter', err);
      });
    } catch (err) {
      // One malformed record must not fail the whole SQS batch.
      console.error('Failed to process record', record.messageId, err);
    }
  }

  return { batchItemFailures: [] };
};
