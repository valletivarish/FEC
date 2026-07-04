'use strict';

const { unmarshall } = require('@aws-sdk/util-dynamodb');

// Fires on DynamoDB Streams INSERT events for CampusPulseAlerts.
exports.handler = async (event) => {
  const records = (event && event.Records) || [];

  for (const record of records) {
    try {
      if (record.eventName !== 'INSERT' || !record.dynamodb || !record.dynamodb.NewImage) {
        continue;
      }
      const alert = unmarshall(record.dynamodb.NewImage);
      if (alert.severity !== 'BREACH') {
        continue;
      }
      // Real deployment would push to SNS/webhook here; console.log is sufficient for the brief.
      console.log('Dispatching BREACH alert', {
        zoneId: alert.zoneId,
        eventType: alert.eventType,
        timestamp: alert.timestamp,
      });
    } catch (err) {
      console.error('Failed to process stream record', record.eventID, err);
    }
  }

  return { statusCode: 200 };
};
