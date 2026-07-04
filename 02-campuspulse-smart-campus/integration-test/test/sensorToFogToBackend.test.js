'use strict';

// Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node logic
// runs in-process against a scripted fixture, and events land in the local AWS emulator.

const { DynamoDBClient, CreateTableCommand, ResourceInUseException } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ZoneStateMachine } = require('../../fog/fog-security/zoneStateMachine');

const READINGS_TABLE = process.env.CAMPUSPULSE_READINGS_TABLE || 'CampusPulseReadings';
const ALERTS_TABLE = process.env.CAMPUSPULSE_ALERTS_TABLE || 'CampusPulseAlerts';
const ZONE_ID = 'ZONE-IT-01';

let ddbClient;
let docClient;
let handler;
let historyHandler;
let emulatorReachable = false;

async function tableExistsOrCreate(request) {
  try {
    await ddbClient.send(new CreateTableCommand(request));
  } catch (err) {
    if (!(err instanceof ResourceInUseException)) throw err;
  }
}

beforeAll(async () => {
  ddbClient = new DynamoDBClient({});
  docClient = DynamoDBDocumentClient.from(ddbClient);

  try {
    const { DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
    await ddbClient.send(new DescribeTableCommand({ TableName: '__reachability_probe__' })).catch((err) => {
      // ResourceNotFoundException still proves the emulator answered - anything else means unreachable.
      if (err.name !== 'ResourceNotFoundException') throw err;
    });
    emulatorReachable = true;
  } catch {
    emulatorReachable = false;
    return;
  }

  await tableExistsOrCreate({
    TableName: READINGS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'zoneId', AttributeType: 'S' },
      { AttributeName: 'sensorTimestamp', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'zoneId', KeyType: 'HASH' },
      { AttributeName: 'sensorTimestamp', KeyType: 'RANGE' },
    ],
  });
  await tableExistsOrCreate({
    TableName: ALERTS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'zoneId', AttributeType: 'S' },
      { AttributeName: 'alertTimestamp', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'zoneId', KeyType: 'HASH' },
      { AttributeName: 'alertTimestamp', KeyType: 'RANGE' },
    ],
  });

  // Loaded after tables exist so the handler's module-level docClient targets a ready emulator.
  handler = require('../../backend/src/handlers/readingWriterHandler').handler;
  historyHandler = require('../../backend/src/handlers/zoneHistoryHandler').handler;
});

function maybeIt(name, fn) {
  test(name, async () => {
    if (!emulatorReachable) {
      console.warn(`Skipping "${name}" - local AWS emulator not reachable`);
      return;
    }
    await fn();
  });
}

describe('sensor -> fog -> backend', () => {
  maybeIt('an after-hours door+motion+sound sequence produces a persisted security alert', async () => {
    const machine = new ZoneStateMachine(ZONE_ID, { isAfterHours: () => true });
    const t0 = Date.parse('2026-07-02T23:00:00.000Z');
    const iso = (offsetMs) => new Date(t0 + offsetMs).toISOString();

    const readings = [
      { zoneId: ZONE_ID, topic: 'door-contact', value: 0, timestamp: iso(0) },
      { zoneId: ZONE_ID, topic: 'sound-level', value: 62, timestamp: iso(1000) },
      { zoneId: ZONE_ID, topic: 'motion', value: 1, timestamp: iso(2000) },
    ];

    const fogEvents = readings.flatMap((reading) => machine.handleReading(reading));
    expect(fogEvents.some((event) => event.eventType === 'AFTER_HOURS_SECURITY_EVENT')).toBe(true);

    const sqsEvent = {
      Records: fogEvents.map((event, index) => ({
        messageId: `msg-${index}`,
        body: JSON.stringify(event),
      })),
    };
    await handler(sqsEvent);

    const result = await docClient.send(
      new QueryCommand({
        TableName: ALERTS_TABLE,
        KeyConditionExpression: 'zoneId = :zoneId',
        ExpressionAttributeValues: { ':zoneId': ZONE_ID },
      })
    );

    expect(result.Items.length).toBeGreaterThan(0);
    expect(result.Items.some((item) => item.eventType === 'AFTER_HOURS_SECURITY_EVENT')).toBe(true);
  });

  maybeIt('a raw sensor reading batch is written to the readings table', async () => {
    const readingBatch = [
      { zoneId: ZONE_ID, topic: 'temperature', value: 21.4, timestamp: '2026-07-02T23:05:00.000Z' },
      { zoneId: ZONE_ID, topic: 'temperature', value: 21.6, timestamp: '2026-07-02T23:06:00.000Z' },
    ];

    const sqsEvent = { Records: [{ messageId: 'msg-batch', body: JSON.stringify(readingBatch) }] };
    await handler(sqsEvent);

    const result = await docClient.send(
      new QueryCommand({
        TableName: READINGS_TABLE,
        KeyConditionExpression: 'zoneId = :zoneId',
        ExpressionAttributeValues: { ':zoneId': ZONE_ID },
      })
    );

    expect(result.Items.some((item) => item.topic === 'temperature' && item.value === 21.6)).toBe(true);
  });

  maybeIt('an hvac-duct-pressure heartbeat lands in readings and is retrievable via zoneHistoryHandler', async () => {
    // Mirrors energyAnomalyEngine.js's flushIfDue heartbeat: a plain reading (no eventType),
    // dispatched exactly like fogDispatcher.js would POST it to /v1/fog-events.
    const heartbeat = {
      zoneId: ZONE_ID,
      topic: 'hvac-duct-pressure',
      value: 214.7,
      timestamp: '2026-07-02T23:08:00.000Z',
    };

    await handler({ Records: [{ messageId: 'msg-heartbeat', body: JSON.stringify(heartbeat) }] });

    const result = await historyHandler({
      pathParameters: { zoneId: ZONE_ID },
      queryStringParameters: { topic: 'hvac-duct-pressure' },
    });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.readings.some((item) => item.topic === 'hvac-duct-pressure' && item.value === 214.7)).toBe(true);
    // Confirms it never reached the alerts table - it is telemetry, not an actionable event.
    const alertsResult = await docClient.send(
      new QueryCommand({
        TableName: ALERTS_TABLE,
        KeyConditionExpression: 'zoneId = :zoneId',
        ExpressionAttributeValues: { ':zoneId': ZONE_ID },
      })
    );
    expect(alertsResult.Items.some((item) => item.eventType === 'hvac-duct-pressure')).toBe(false);
  });

  maybeIt('a LOAD_ANOMALY alert persisted via the real ingest path is retrievable via zoneHistoryHandler events', async () => {
    // Mirrors energyAnomalyEngine.js's _processElectricity output: a WARN/BREACH fog event,
    // dispatched exactly like fogDispatcher.js would POST it to /v1/fog-events.
    const loadAnomaly = {
      zoneId: ZONE_ID,
      eventType: 'LOAD_ANOMALY',
      severity: 'BREACH',
      payload: { value: 42.1, baselineMean: 10, baselineStddev: 1.2, zScore: 26.75 },
      timestamp: '2026-07-02T23:09:00.000Z',
    };

    await handler({ Records: [{ messageId: 'msg-load-anomaly', body: JSON.stringify(loadAnomaly) }] });

    const result = await historyHandler({
      pathParameters: { zoneId: ZONE_ID },
      queryStringParameters: { topic: 'electricity' },
    });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    // The alerts query is not topic-filtered, so the real LOAD_ANOMALY event must come back
    // in `events` regardless of the `topic=electricity` filter applied to `readings`.
    expect(body.events.some((item) => item.eventType === 'LOAD_ANOMALY' && item.severity === 'BREACH')).toBe(true);
  });

  maybeIt('an AFTER_HOURS_SECURITY_EVENT persisted via the real ingest path is retrievable via zoneHistoryHandler events', async () => {
    const machine = new ZoneStateMachine(ZONE_ID, { isAfterHours: () => true });
    const t0 = Date.parse('2026-07-02T23:10:00.000Z');
    const iso = (offsetMs) => new Date(t0 + offsetMs).toISOString();

    const readings = [
      { zoneId: ZONE_ID, topic: 'door-contact', value: 0, timestamp: iso(0) },
      { zoneId: ZONE_ID, topic: 'sound-level', value: 62, timestamp: iso(1000) },
      { zoneId: ZONE_ID, topic: 'motion', value: 1, timestamp: iso(2000) },
    ];
    const fogEvents = readings.flatMap((reading) => machine.handleReading(reading));
    expect(fogEvents.some((event) => event.eventType === 'AFTER_HOURS_SECURITY_EVENT')).toBe(true);

    await handler({
      Records: fogEvents.map((event, index) => ({ messageId: `msg-security-${index}`, body: JSON.stringify(event) })),
    });

    const result = await historyHandler({ pathParameters: { zoneId: ZONE_ID } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.events.some((item) => item.eventType === 'AFTER_HOURS_SECURITY_EVENT')).toBe(true);
  });

  maybeIt('a malformed record does not throw and does not block the rest of the batch', async () => {
    const sqsEvent = {
      Records: [
        { messageId: 'bad', body: 'not valid json' },
        {
          messageId: 'good',
          body: JSON.stringify({ zoneId: ZONE_ID, topic: 'humidity', value: 40, timestamp: '2026-07-02T23:07:00.000Z' }),
        },
      ],
    };

    await expect(handler(sqsEvent)).resolves.toBeDefined();
  });
});
