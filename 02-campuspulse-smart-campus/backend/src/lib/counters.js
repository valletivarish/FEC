'use strict';

const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamoClient');

const COUNTERS_TABLE = process.env.CAMPUSPULSE_COUNTERS_TABLE || 'CampusPulseCounters';

// A single atomic ADD per SQS record actually processed - a genuine running total,
// not derived from item counts (which would double-count rollups/heartbeats differently).
async function incrementCounter(counterName, by = 1) {
  await docClient.send(
    new UpdateCommand({
      TableName: COUNTERS_TABLE,
      Key: { counterName },
      UpdateExpression: 'ADD #value :by',
      ExpressionAttributeNames: { '#value': 'value' },
      ExpressionAttributeValues: { ':by': by },
    })
  );
}

module.exports = { incrementCounter, COUNTERS_TABLE };
