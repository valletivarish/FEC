const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/dynamoClient');
const { incrementCounter } = require('../../lib/counters');

const TABLE_NAME = process.env.PARKFOG_EVENTS_TABLE;

// partition key falls back to zoneId since zone-level events (flood_risk,
// zone_pressure) have no bayId
function buildItem(fogEvent) {
  const entityId = fogEvent.bayId || fogEvent.zoneId;
  if (!entityId || !fogEvent.type || !fogEvent.timestamp) {
    throw new Error('event missing entityId, type, or timestamp');
  }
  const eventTypeTimestamp = `${fogEvent.type}#${fogEvent.timestamp}`;
  return { ...fogEvent, entityId, eventTypeTimestamp };
}

// counters are a dashboard nicety, not core delivery: a counter failure must never sink
// the actual event write, so it gets its own try/catch instead of sharing the record's
async function bumpCounter(name) {
  try {
    await incrementCounter(name);
  } catch (err) {
    console.error('failed to bump counter', name, err);
  }
}

exports.handler = async (event) => {
  const records = (event && event.Records) || [];

  for (const record of records) {
    // received count reflects every SQS record this handler was handed, ingest or not
    await bumpCounter('receivedCount');
    try {
      const fogEvent = JSON.parse(record.body);
      const item = buildItem(fogEvent);
      await docClient.send(
        new PutCommand({ TableName: TABLE_NAME, Item: item })
      );
      // stored count only advances once the item actually lands in DynamoDB
      await bumpCounter('storedCount');
    } catch (err) {
      // one bad record must not fail the whole SQS batch
      console.error('failed to ingest bay event record', record && record.messageId, err);
    }
  }

  return { batchItemFailures: [] };
};
