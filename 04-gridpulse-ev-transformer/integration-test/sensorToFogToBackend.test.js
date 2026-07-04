// Proves sensor -> fog -> backend end to end without touching real AWS: real fog-agent
// logic runs in-process against a scripted reading sequence, and the resulting events land
// in the local AWS emulator via the real Lambda handler.
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const { ChargerBayAgent } = require('../fog/bay-agent/chargerBaySetpoint');
const { TransformerGuardAgent } = require('../fog/transformer-guard/transformerCurtailment');
const { handler: ingestHubTelemetryHandler } = require('../backend/lambdas/ingestHubTelemetry');

const READINGS_TABLE = process.env.GRIDPULSE_READINGS_TABLE || 'GridPulseHubSensorReadings';
const CURTAILMENT_TABLE = process.env.GRIDPULSE_CURTAILMENT_TABLE || 'GridPulseCurtailmentEvents';
const HUB_ID = 'hub-it-01';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function ensureTable(tableName, sortKeyName) {
  try {
    await docClient.send(new DescribeTableCommand({ TableName: tableName }));
    return;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
  }
  await docClient.send(new CreateTableCommand({
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'hubId', AttributeType: 'S' },
      { AttributeName: sortKeyName, AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'hubId', KeyType: 'HASH' },
      { AttributeName: sortKeyName, KeyType: 'RANGE' },
    ],
  }));
}

beforeAll(async () => {
  await ensureTable(READINGS_TABLE, 'metricType#timestamp');
  await ensureTable(CURTAILMENT_TABLE, 'timestamp');
});

function kinesisEvent(events) {
  return {
    Records: events.map((event) => ({
      kinesis: { data: Buffer.from(JSON.stringify(event)).toString('base64') },
    })),
  };
}

test('a charging EV drives a bay_setpoint event that lands in the readings table', async () => {
  const agent = new ChargerBayAgent();
  const bayId = 'bay-it-01';

  const events = [
    ...agent.onReading({ hubId: HUB_ID, bayId, metric: 'bay/connector-state', value: 'charging', timestamp: '2026-07-03T09:00:00.000Z' }),
    ...agent.onReading({ hubId: HUB_ID, bayId, metric: 'bay/ev-soc', value: 50, timestamp: '2026-07-03T09:00:01.000Z' }),
  ];

  expect(events.some((e) => e.type === 'bay_setpoint' && e.setpointAmps === 32)).toBe(true);

  await ingestHubTelemetryHandler(kinesisEvent(events));

  const result = await docClient.send(new QueryCommand({
    TableName: READINGS_TABLE,
    KeyConditionExpression: 'hubId = :h',
    ExpressionAttributeValues: { ':h': HUB_ID },
  }));
  expect(result.Items.some((item) => item.type === 'bay_setpoint' && item.setpointAmps === 32)).toBe(true);
});

test('a transformer overload ramp escalates to rung 2, sheds the lowest-SoC bay in-process, and persists the curtailment event', async () => {
  const lowSocBay = 'bay-it-low-soc';
  const highSocBay = 'bay-it-high-soc';
  const bayAgents = new Map([
    [lowSocBay, new ChargerBayAgent()],
    [highSocBay, new ChargerBayAgent()],
  ]);
  // seed each bay's known SoC so the guard's shed decision is deterministic
  bayAgents.get(lowSocBay).onReading({ hubId: HUB_ID, bayId: lowSocBay, metric: 'bay/ev-soc', value: 15, timestamp: '2026-07-03T10:00:00.000Z' });
  bayAgents.get(highSocBay).onReading({ hubId: HUB_ID, bayId: highSocBay, metric: 'bay/ev-soc', value: 90, timestamp: '2026-07-03T10:00:00.000Z' });

  const guard = new TransformerGuardAgent(bayAgents);

  // 370A crosses the rung-2 threshold (>=360, <390) directly from rung 0 — escalation is immediate.
  const escalation = guard.onReading({ hubId: HUB_ID, metric: 'transformer/load-amps', value: 370, timestamp: '2026-07-03T10:00:05.000Z' });
  expect(escalation).toHaveLength(1);
  expect(escalation[0]).toMatchObject({ type: 'curtailment_event', rung: 2, rungLabel: 'curtail', shedBayId: lowSocBay });

  // the in-process safety mechanism must apply instantly, with no cloud round trip involved
  expect(bayAgents.get(lowSocBay).curtailmentCeiling.get(lowSocBay)).toBe(0);
  expect(bayAgents.get(highSocBay).curtailmentCeiling.get(highSocBay)).toBeCloseTo(32 * 0.4);

  await ingestHubTelemetryHandler(kinesisEvent(escalation));

  const result = await docClient.send(new QueryCommand({
    TableName: CURTAILMENT_TABLE,
    KeyConditionExpression: 'hubId = :h',
    ExpressionAttributeValues: { ':h': HUB_ID },
  }));
  expect(result.Items.some((item) => item.rung === 2 && item.shedBayId === lowSocBay)).toBe(true);
});

test('transformer rung does not de-escalate until 3 consecutive lower-rung samples confirm it', () => {
  const guard = new TransformerGuardAgent(new Map());
  guard.onReading({ hubId: HUB_ID, metric: 'transformer/load-amps', value: 370, timestamp: '2026-07-03T11:00:00.000Z' });
  expect(guard.currentRung).toBe(2);

  const first = guard.onReading({ hubId: HUB_ID, metric: 'transformer/load-amps', value: 100, timestamp: '2026-07-03T11:00:01.000Z' });
  const second = guard.onReading({ hubId: HUB_ID, metric: 'transformer/load-amps', value: 100, timestamp: '2026-07-03T11:00:02.000Z' });
  expect(first).toHaveLength(0);
  expect(second).toHaveLength(0);
  expect(guard.currentRung).toBe(2);

  const third = guard.onReading({ hubId: HUB_ID, metric: 'transformer/load-amps', value: 100, timestamp: '2026-07-03T11:00:03.000Z' });
  expect(third).toHaveLength(1);
  expect(guard.currentRung).toBe(0);
});

test('a malformed Kinesis record does not sink the rest of the batch', async () => {
  const badEvent = { Records: [{ kinesis: { data: Buffer.from('not valid json').toString('base64') } }] };
  await expect(ingestHubTelemetryHandler(badEvent)).resolves.toEqual({ batchItemFailures: [] });
});
