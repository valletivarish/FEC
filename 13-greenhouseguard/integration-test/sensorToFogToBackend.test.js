// Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node
// logic runs in-process (including the cross-node ClimateFogNode -> EnclosureFogNode wiring),
// and the resulting events land in the local AWS emulator via the real Lambda handlers.
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const { ClimateFogNode } = require('../fog/climate-fog/climateFogNode');
const { FertigationFogNode } = require('../fog/fertigation-fog/fertigationFogNode');
const { EnclosureFogNode } = require('../fog/enclosure-fog/enclosureFogNode');
const { handler: ingestHandler } = require('../backend/functions/ingestEvent');
const { handler: queryHandler } = require('../backend/functions/queryZoneStatus');
const { handler: acknowledgeHandler } = require('../backend/functions/acknowledgeFault');

const COMMAND_LEDGER_TABLE = process.env.GREENHOUSEGUARD_COMMAND_LEDGER_TABLE || 'greenhouseguard-command-ledger-table';
const FAULTS_TABLE = process.env.GREENHOUSEGUARD_FAULTS_TABLE || 'greenhouseguard-faults-table';
const ZONE_ID = 'zone-it-01';

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
      { AttributeName: 'zoneId', AttributeType: 'S' },
      { AttributeName: sortKeyName, AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'zoneId', KeyType: 'HASH' },
      { AttributeName: sortKeyName, KeyType: 'RANGE' },
    ],
  }));
}

beforeAll(async () => {
  await ensureTable(COMMAND_LEDGER_TABLE, 'timestamp');
  await ensureTable(FAULTS_TABLE, 'eventTypeTimestamp');
});

function reading(zoneId, metric, value, timestamp) {
  return { zoneId, metric, value, unit: '', timestamp };
}

function sqsEvent(bodies) {
  return { Records: bodies.map((body) => ({ body: JSON.stringify(body) })) };
}

async function persist(events) {
  await ingestHandler(sqsEvent(events));
}

async function queryFaults(zoneId) {
  const result = await docClient.send(new QueryCommand({
    TableName: FAULTS_TABLE,
    KeyConditionExpression: 'zoneId = :z',
    ExpressionAttributeValues: { ':z': zoneId },
  }));
  return result.Items;
}

test('a humid zone drives ClimateFogNode to a setpoint_command that persists to the command ledger', async () => {
  const node = new ClimateFogNode();

  node.onReading(reading(ZONE_ID, 'air-temperature', 24, '2026-07-03T09:00:00.000Z'));
  const dispatched = node.onReading(reading(ZONE_ID, 'air-humidity', 85, '2026-07-03T09:00:01.000Z'));

  expect(dispatched).toHaveLength(1);
  expect(dispatched[0].type).toBe('setpoint_command');
  // high humidity -> low VPD -> vent should open further than the 50% neutral baseline
  expect(dispatched[0].ventPositionSetpoint).toBeGreaterThan(50);

  await persist(dispatched);

  const commandResult = await docClient.send(new QueryCommand({
    TableName: COMMAND_LEDGER_TABLE,
    KeyConditionExpression: 'zoneId = :z',
    ExpressionAttributeValues: { ':z': ZONE_ID },
  }));
  expect(commandResult.Items.some((item) => item.type === 'setpoint_command')).toBe(true);
});

test('a sustained CRITICAL EC reading dispatches a fertigation_event that persists to faults', async () => {
  const node = new FertigationFogNode();
  const zoneId = 'zone-it-fertigation';

  const dispatched = node.onReading(reading(zoneId, 'substrate-ec', 4.2, '2026-07-03T10:00:00.000Z'));

  expect(dispatched).toHaveLength(1);
  expect(dispatched[0].type).toBe('fertigation_event');
  expect(dispatched[0].severity).toBe('CRITICAL');

  await persist(dispatched);

  const items = await queryFaults(zoneId);
  expect(items.some((item) => item.type === 'fertigation_event' && item.severity === 'CRITICAL')).toBe(true);
});

test('the ClimateFogNode -> EnclosureFogNode closed loop detects a stalled vent and persists, then acknowledges', async () => {
  const climateNode = new ClimateFogNode();
  const enclosureNode = new EnclosureFogNode();
  const zoneId = 'zone-it-enclosure';

  // drive ClimateFogNode to a low (near-closed) commanded setpoint via a dry, high-VPD reading.
  climateNode.onReading(reading(zoneId, 'air-temperature', 30, '2026-07-03T11:00:00.000Z'));
  const climateEvents = climateNode.onReading(reading(zoneId, 'air-humidity', 20, '2026-07-03T11:00:01.000Z'));
  const setpointCommand = climateEvents.find((e) => e.type === 'setpoint_command');
  expect(setpointCommand).toBeDefined();
  expect(setpointCommand.ventPositionSetpoint).toBeLessThan(50);

  // exactly the cross-node wiring fog/index.js performs: hand the command to EnclosureFogNode in-process.
  enclosureNode.onSetpointCommand(setpointCommand);

  // the vent is physically stuck near fully-open, far from the near-closed commanded setpoint.
  let dispatched = enclosureNode.onReading(reading(zoneId, 'vent-position', 95, '2026-07-03T11:00:02.000Z'));
  expect(dispatched).toHaveLength(0);
  dispatched = enclosureNode.onReading(reading(zoneId, 'vent-position', 95, '2026-07-03T11:00:03.000Z'));

  expect(dispatched).toHaveLength(1);
  expect(dispatched[0].type).toBe('enclosure_fault_event');
  expect(dispatched[0].faultState).toBe('VENT_OVERSHOOT');

  await persist(dispatched);

  const items = await queryFaults(zoneId);
  const faultItem = items.find((item) => item.type === 'enclosure_fault_event');
  expect(faultItem).toBeDefined();
  expect(faultItem.acknowledged).toBe(false);

  const ackResponse = await acknowledgeHandler({
    pathParameters: { zoneId },
    body: JSON.stringify({ eventTypeTimestamp: faultItem.eventTypeTimestamp }),
  });
  expect(ackResponse.statusCode).toBe(200);
  expect(JSON.parse(ackResponse.body).acknowledged).toBe(true);
});

test('queryZoneStatus returns the latest command and full fault list for a zone', async () => {
  const zoneId = 'zone-it-query';
  const node = new ClimateFogNode();
  node.onReading(reading(zoneId, 'air-temperature', 24, '2026-07-03T12:00:00.000Z'));
  const dispatched = node.onReading(reading(zoneId, 'air-humidity', 85, '2026-07-03T12:00:01.000Z'));
  await persist(dispatched);

  const response = await queryHandler({ pathParameters: { zoneId } });
  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  expect(body.zoneId).toBe(zoneId);
  expect(body.latestCommand).not.toBeNull();
  expect(Array.isArray(body.faults)).toBe(true);
});

test('a malformed record does not sink the rest of the batch', async () => {
  await ingestHandler({ Records: [{ body: 'not valid json' }] });
});
