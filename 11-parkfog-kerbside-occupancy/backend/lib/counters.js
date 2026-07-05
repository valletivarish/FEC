const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamoClient');

const TABLE_NAME = process.env.PARKFOG_EVENTS_TABLE;

// counters live in the same single-table design under a reserved entityId so no extra
// table is needed; ADD is atomic so concurrent Lambda invocations never clobber each other
const COUNTERS_ENTITY_ID = '__parkfog_counters__';
const COUNTERS_SORT_KEY = 'counters#totals';

async function incrementCounter(counterName, by = 1) {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { entityId: COUNTERS_ENTITY_ID, eventTypeTimestamp: COUNTERS_SORT_KEY },
      UpdateExpression: `ADD ${counterName} :by`,
      ExpressionAttributeValues: { ':by': by },
      ReturnValues: 'UPDATED_NEW',
    })
  );
  // Attributes can come back empty against some emulator/mock configs even though the ADD
  // itself succeeded; falling back to the delta at least returns a real number, not undefined
  return result.Attributes ? result.Attributes[counterName] : by;
}

module.exports = { incrementCounter, COUNTERS_ENTITY_ID, COUNTERS_SORT_KEY };
