// Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node
// logic runs in-process against a scripted reading sequence, and the resulting events land
// in the local AWS emulator via the real Lambda handler's write path.
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const { BaySensingFog } = require('../fog/bay-sensing/baySensingFog');
const { AccessPaymentFog } = require('../fog/access-payment/accessPaymentFog');
const { KerbConditionsFog } = require('../fog/kerb-conditions/kerbConditionsFog');
const { handler: ingestHandler } = require('../backend/functions/ingestBayEvents');

const TABLE = process.env.PARKFOG_EVENTS_TABLE || 'parkfog-events-table';
const ZONE_ID = 'zone-it-01';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function ensureTable() {
  try {
    await docClient.send(new DescribeTableCommand({ TableName: TABLE }));
    return;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
  }
  await docClient.send(new CreateTableCommand({
    TableName: TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'entityId', AttributeType: 'S' },
      { AttributeName: 'eventTypeTimestamp', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'entityId', KeyType: 'HASH' },
      { AttributeName: 'eventTypeTimestamp', KeyType: 'RANGE' },
    ],
  }));
}

beforeAll(async () => {
  await ensureTable();
});

function reading(scope, id, metric, value, timestamp) {
  return { scope, id, metric, value, unit: '', timestamp };
}

function kinesisLikeSqsEvent(bodies) {
  return { Records: bodies.map((body) => ({ body: JSON.stringify(body) })) };
}

async function persist(events) {
  await ingestHandler(kinesisLikeSqsEvent(events));
}

async function queryEntity(entityId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'entityId = :e',
    ExpressionAttributeValues: { ':e': entityId },
  }));
  return result.Items;
}

test('a fused magnetometer+infrared vote crossing the up-threshold transitions a bay to OCCUPIED and persists', async () => {
  const node = new BaySensingFog({});
  const bayId = 'bay-it-01';
  const dispatched = [];

  dispatched.push(...node.onReading(reading('bay', bayId, 'bay-infrared', 1.0, '2026-07-03T09:00:00.000Z')));
  dispatched.push(...node.onReading(reading('bay', bayId, 'bay-magnetometer', 50, '2026-07-03T09:00:01.000Z')));
  dispatched.push(...node.onReading(reading('bay', bayId, 'bay-magnetometer', 50, '2026-07-03T09:00:02.000Z')));

  const occupied = dispatched.find((e) => e.state === 'OCCUPIED');
  expect(occupied).toBeDefined();

  await persist([occupied]);

  const items = await queryEntity(bayId);
  expect(items.some((item) => item.type === 'bay_state_event' && item.state === 'OCCUPIED')).toBe(true);
});

test('a disabled bay occupied well past its badge-scan window is flagged as a violation and persists', async () => {
  const bayConfig = { 'bay-it-disabled': { isDisabledBay: true } };
  const node = new BaySensingFog(bayConfig);
  const bayId = 'bay-it-disabled';

  // 21 alternating magnetometer/infrared readings advance the disabled-bay tick counter
  // past the 20-tick badge-scan window before the fused vote ever crosses into OCCUPIED.
  for (let i = 0; i < 10; i += 1) {
    node.onReading(reading('bay', bayId, 'bay-infrared', 0.1, `2026-07-03T10:${String(i).padStart(2, '0')}:00.000Z`));
    node.onReading(reading('bay', bayId, 'bay-magnetometer', 5, `2026-07-03T10:${String(i).padStart(2, '0')}:30.000Z`));
  }
  node.onReading(reading('bay', bayId, 'bay-infrared', 1.0, '2026-07-03T10:20:00.000Z'));
  const occupyEvents = node.onReading(reading('bay', bayId, 'bay-magnetometer', 50, '2026-07-03T10:20:30.000Z'));
  const finalEvents = node.onReading(reading('bay', bayId, 'bay-magnetometer', 50, '2026-07-03T10:21:00.000Z'));

  const violation = [...occupyEvents, ...finalEvents].find((e) => e.state === 'OCCUPIED');
  expect(violation).toBeDefined();
  expect(violation.disabledBayViolation).toBe(true);

  await persist([violation]);

  const items = await queryEntity(bayId);
  expect(items.some((item) => item.type === 'bay_state_event' && item.disabledBayViolation === true)).toBe(true);
});

test('a zero-balance non-exempt bay dispatches an overstay event immediately and persists', async () => {
  const node = new AccessPaymentFog();
  const bayId = 'bay-it-overstay';

  const events = node.onReading(reading('bay', bayId, 'meter-payment', 0, '2026-07-03T11:00:00.000Z'));
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('overstay_event');

  await persist(events);

  const items = await queryEntity(bayId);
  expect(items.some((item) => item.type === 'overstay_event')).toBe(true);
});

test('a sustained flood level above the closed threshold flips the zone band and persists', async () => {
  const node = new KerbConditionsFog();

  const readings = [250, 250, 250].map((v, i) =>
    reading('zone', ZONE_ID, 'kerb-flood-level', v, `2026-07-03T12:0${i}:00.000Z`));
  let dispatched = [];
  for (const r of readings) {
    dispatched = node.onReading(r);
  }

  expect(dispatched).toHaveLength(1);
  expect(dispatched[0].band).toBe('closed');

  await persist(dispatched);

  const items = await queryEntity(ZONE_ID);
  expect(items.some((item) => item.type === 'flood_risk_event' && item.band === 'closed')).toBe(true);
});

test('a malformed record does not sink the rest of the batch', async () => {
  await ingestHandler({ Records: [{ body: 'not valid json' }] });
});
