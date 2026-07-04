const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const COMMAND_LEDGER_TABLE = process.env.GREENHOUSEGUARD_COMMAND_LEDGER_TABLE;
const FAULTS_TABLE = process.env.GREENHOUSEGUARD_FAULTS_TABLE;

// reserved zoneId/sort-key pair for a single running-counters row, sharing the faults table so
// systemStatus can read it with the same client without a dedicated counters table
const COUNTERS_ZONE_ID = '__counters__';
const COUNTERS_SORT_KEY = 'system_message_counters';

async function bumpCounter(attribute) {
  await client.send(new UpdateCommand({
    TableName: FAULTS_TABLE,
    Key: { zoneId: COUNTERS_ZONE_ID, eventTypeTimestamp: COUNTERS_SORT_KEY },
    UpdateExpression: `ADD ${attribute} :one`,
    ExpressionAttributeValues: { ':one': 1 },
  }));
}

// setpoint_command is the only event that represents a live control decision, so it
// gets its own ledger keyed for fast "latest per zone" queries; everything else is a fault/log entry.
exports.handler = async (event) => {
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      await bumpCounter('messagesReceived');

      if (body.type === 'setpoint_command') {
        await client.send(new PutCommand({
          TableName: COMMAND_LEDGER_TABLE,
          Item: {
            zoneId: body.zoneId,
            timestamp: body.timestamp,
            ...body,
          },
        }));
      } else {
        await client.send(new PutCommand({
          TableName: FAULTS_TABLE,
          Item: {
            zoneId: body.zoneId,
            eventTypeTimestamp: `${body.type}#${body.timestamp}`,
            acknowledged: false,
            ...body,
          },
        }));
      }

      await bumpCounter('messagesStored');
    } catch (err) {
      // one bad record must not sink the rest of the batch
      console.error('Failed to ingest record', record, err);
    }
  }
};
