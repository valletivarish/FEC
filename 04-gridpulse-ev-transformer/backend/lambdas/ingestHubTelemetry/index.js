const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const READINGS_TABLE = process.env.GRIDPULSE_READINGS_TABLE;
const CURTAILMENT_TABLE = process.env.GRIDPULSE_CURTAILMENT_TABLE;
const OPS_COUNTERS_TABLE = process.env.GRIDPULSE_OPS_COUNTERS_TABLE;
const OPS_COUNTERS_ID = 'gridpulse-backend';

// single-item atomic ADD so concurrent Lambda invocations never lose a count under a batch race
async function bumpCounters({ received, stored }) {
  if (!OPS_COUNTERS_TABLE) return;
  await docClient.send(new UpdateCommand({
    TableName: OPS_COUNTERS_TABLE,
    Key: { counterId: OPS_COUNTERS_ID },
    UpdateExpression: 'ADD messagesReceived :received, messagesStored :stored',
    ExpressionAttributeValues: { ':received': received, ':stored': stored },
  }));
}

// readings table SK combines metric type + timestamp so per-metric history is queryable and sorted
async function writeReadingEvent(event) {
  const item = {
    hubId: event.hubId,
    'metricType#timestamp': `${event.type}#${event.timestamp}`,
    ...event,
  };
  await docClient.send(new PutCommand({ TableName: READINGS_TABLE, Item: item }));
}

// curtailment ladder transitions are rare and hub-scoped, so timestamp alone is a unique SK
async function writeCurtailmentEvent(event) {
  const item = {
    hubId: event.hubId,
    timestamp: event.timestamp,
    ...event,
  };
  await docClient.send(new PutCommand({ TableName: CURTAILMENT_TABLE, Item: item }));
}

exports.handler = async (event) => {
  const records = (event && event.Records) || [];
  let received = 0;
  let stored = 0;

  for (const record of records) {
    received += 1;
    try {
      const payload = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
      const parsedEvent = JSON.parse(payload);

      if (parsedEvent.type === 'bay_setpoint' || parsedEvent.type === 'der_mode' || parsedEvent.type === 'der_summary') {
        await writeReadingEvent(parsedEvent);
        stored += 1;
      } else if (parsedEvent.type === 'curtailment_event') {
        await writeCurtailmentEvent(parsedEvent);
        stored += 1;
      } else {
        console.error('ingestHubTelemetry: unknown event type', parsedEvent.type);
      }
    } catch (err) {
      // one malformed record must never fail the rest of the Kinesis batch
      console.error('ingestHubTelemetry: failed to process record', err.message);
    }
  }

  if (received > 0) {
    try {
      await bumpCounters({ received, stored });
    } catch (err) {
      // counters are an operational metric, not the ingest path — never fail the batch over them
      console.error('ingestHubTelemetry: failed to update ops counters', err.message);
    }
  }

  return { batchItemFailures: [] };
};
