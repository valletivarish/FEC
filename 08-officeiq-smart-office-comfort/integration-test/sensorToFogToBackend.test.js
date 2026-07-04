// Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node
// logic runs in-process against a scripted reading sequence, and the resulting events land
// in the local AWS emulator via the real worker's processMessage write path.
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const { OccupancyFog } = require('../fog/fog-occupancy/reconcile');
const { ComfortFog } = require('../fog/fog-comfort/ventilationAnomaly');
const { UsageFog } = require('../fog/fog-usage/deviceLeftOn');
const { processMessage } = require('../backend/worker/ingestWorker');

const READINGS_TABLE = process.env.OFFICEIQ_READINGS_TABLE || 'OfficeIQReadings';
const ZONE_ID = 'zone-it-01';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function ensureTable() {
  try {
    await docClient.send(new DescribeTableCommand({ TableName: READINGS_TABLE }));
    return;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
  }
  await docClient.send(new CreateTableCommand({
    TableName: READINGS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'zoneId', AttributeType: 'S' },
      { AttributeName: 'eventTypeTimestamp', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'zoneId', KeyType: 'HASH' },
      { AttributeName: 'eventTypeTimestamp', KeyType: 'RANGE' },
    ],
  }));
}

function reading(metric, value, timestamp) {
  return { zoneId: ZONE_ID, metric, value, unit: '', timestamp };
}

beforeAll(async () => {
  await ensureTable();
});

test('a standing-room discrepancy sustained for 3 ticks resolves headcount toward the people-counter and persists', async () => {
  const node = new OccupancyFog();
  const dispatched = [];

  // desk-occupancy (2) vs people-counter (6): |2-6|=4 >= 3, netPeopleCount higher -> STANDING_ROOM
  dispatched.push(...node.onReading(reading('desk-occupancy', 2, '2026-07-03T09:00:00.000Z')));
  dispatched.push(...node.onReading(reading('people-counter', 6, '2026-07-03T09:00:01.000Z')));
  dispatched.push(...node.onReading(reading('people-counter', 6, '2026-07-03T09:00:02.000Z')));
  dispatched.push(...node.onReading(reading('people-counter', 6, '2026-07-03T09:00:03.000Z')));

  expect(dispatched.every((e) => e.verdict === 'STANDING_ROOM')).toBe(true);
  const last = dispatched[dispatched.length - 1];
  expect(last.resolvedHeadcount).toBe(6);

  for (const event of dispatched) {
    await processMessage(event);
  }

  const result = await docClient.send(new QueryCommand({
    TableName: READINGS_TABLE,
    KeyConditionExpression: 'zoneId = :z',
    ExpressionAttributeValues: { ':z': ZONE_ID },
  }));
  expect(result.Items.some((item) => item.type === 'occupancy_event' && item.verdict === 'STANDING_ROOM')).toBe(true);
});

test('a rising CO2 trend in a closed occupied room triggers a ventilation anomaly and persists', async () => {
  const node = new ComfortFog();
  const dispatched = [];

  dispatched.push(...node.onReading(reading('window-state', 0, '2026-07-03T10:00:00.000Z')));
  dispatched.push(...node.onReading(reading('desk-occupancy', 3, '2026-07-03T10:00:01.000Z')));
  dispatched.push(...node.onReading(reading('room-co2', 700, '2026-07-03T10:00:02.000Z')));
  dispatched.push(...node.onReading(reading('room-co2', 900, '2026-07-03T10:00:03.000Z')));
  dispatched.push(...node.onReading(reading('room-co2', 1100, '2026-07-03T10:00:04.000Z')));

  const anomaly = dispatched.find((e) => e.verdict === 'VENTILATION_ANOMALY');
  expect(anomaly).toBeDefined();
  expect(anomaly.severity).toBe('critical');

  await processMessage(anomaly);

  const result = await docClient.send(new QueryCommand({
    TableName: READINGS_TABLE,
    KeyConditionExpression: 'zoneId = :z',
    ExpressionAttributeValues: { ':z': ZONE_ID },
  }));
  expect(result.Items.some((item) => item.type === 'comfort_event' && item.verdict === 'VENTILATION_ANOMALY')).toBe(true);
});

test('a sustained idle-with-load streak trips DEVICE_LEFT_ON at exactly 20 ticks and persists', async () => {
  const node = new UsageFog();
  const dispatched = [];

  dispatched.push(...node.onReading(reading('plug-power', 50, '2026-07-03T11:00:00.000Z')));
  // first light-level reading seeds the baseline and can never itself qualify as idle-with-load
  dispatched.push(...node.onReading(reading('light-level', 500, '2026-07-03T11:00:01.000Z')));

  for (let i = 0; i < 20; i += 1) {
    dispatched.push(...node.onReading(reading('light-level', 700, `2026-07-03T11:${String(i + 2).padStart(2, '0')}:00.000Z`)));
  }

  const leftOn = dispatched.find((e) => e.verdict === 'DEVICE_LEFT_ON');
  expect(leftOn).toBeDefined();
  expect(leftOn.estimatedWattHoursWasted).toBeGreaterThan(0);

  await processMessage(leftOn);

  const result = await docClient.send(new QueryCommand({
    TableName: READINGS_TABLE,
    KeyConditionExpression: 'zoneId = :z',
    ExpressionAttributeValues: { ':z': ZONE_ID },
  }));
  expect(result.Items.some((item) => item.type === 'usage_event' && item.verdict === 'DEVICE_LEFT_ON')).toBe(true);
});

test('a single occupied reading immediately clears an in-progress idle streak', () => {
  const node = new UsageFog();

  node.onReading(reading('plug-power', 50, '2026-07-03T12:00:00.000Z'));
  node.onReading(reading('light-level', 500, '2026-07-03T12:00:01.000Z'));
  for (let i = 0; i < 10; i += 1) {
    node.onReading(reading('light-level', 700, `2026-07-03T12:${String(i + 2).padStart(2, '0')}:00.000Z`));
  }

  node.onReading(reading('desk-occupancy', 1, '2026-07-03T12:15:00.000Z'));

  const events = [];
  for (let i = 0; i < 19; i += 1) {
    events.push(...node.onReading(reading('light-level', 700, `2026-07-03T12:${String(i + 20).padStart(2, '0')}:00.000Z`)));
  }
  // the streak was reset by the occupied reading, so 19 more idle ticks must not reach the 20-tick threshold
  expect(events.length).toBe(0);
});
