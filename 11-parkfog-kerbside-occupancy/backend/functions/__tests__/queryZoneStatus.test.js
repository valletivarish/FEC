const { mockClient } = require('aws-sdk-client-mock');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/dynamoClient');
const { handler } = require('../queryZoneStatus/index');

const ddbMock = mockClient(docClient);

beforeEach(() => {
  ddbMock.reset();
});

const DEFAULT_BAY_IDS = ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05', 'bay-06'];

// stubs one Items response per entityId so tests can assert fan-out behaviour precisely,
// instead of a single blanket mock that would make every one of the 7 per-entity queries
// resolve identically
function mockEntityResults(resultsByEntityId) {
  ddbMock.on(QueryCommand).callsFake((input) => {
    const entityId = input.ExpressionAttributeValues[':entityId'];
    return Promise.resolve({ Items: resultsByEntityId[entityId] || [] });
  });
}

describe('queryZoneStatus handler', () => {
  test('returns a well-formed 200 response shaped from mocked query results', async () => {
    const zoneEvent = {
      entityId: 'zone-01',
      eventTypeTimestamp: 'flood_risk_event#2026-07-02T10:00:00.000Z',
      type: 'flood_risk_event',
      zoneId: 'zone-01',
      band: 'caution',
      averageFloodLevel: 80,
      timestamp: '2026-07-02T10:00:00.000Z',
    };
    mockEntityResults({ 'zone-01': [zoneEvent] });

    const result = await handler({ pathParameters: { zoneId: 'zone-01' } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.zoneId).toBe('zone-01');
    expect(body.events).toEqual([zoneEvent]);
    expect(body.count).toBe(1);
  });

  // this is the regression test for the bug where bay-scoped events (bay_state_event,
  // overstay_event, ev_fault_event) are stored under entityId=bayId and were invisible to a
  // zone-only query -- the dashboard's Bay Status grid showed UNKNOWN for every bay as a result
  test('merges bay-scoped events (stored under their own bayId entityId) into the zone response', async () => {
    const bayEvent = {
      entityId: 'bay-05',
      eventTypeTimestamp: 'bay_state_event#2026-07-02T10:00:01.000Z',
      type: 'bay_state_event',
      bayId: 'bay-05',
      state: 'OCCUPIED',
      fusedVote: 0.75,
      disabledBayViolation: false,
      timestamp: '2026-07-02T10:00:01.000Z',
    };
    mockEntityResults({ 'bay-05': [bayEvent] });

    const result = await handler({ pathParameters: { zoneId: 'zone-01' } });

    const body = JSON.parse(result.body);
    expect(body.events).toEqual([bayEvent]);
    expect(body.count).toBe(1);
  });

  test('queries the zone entityId plus every configured bay entityId', async () => {
    mockEntityResults({});

    await handler({ pathParameters: { zoneId: 'zone-01' } });

    const calls = ddbMock.commandCalls(QueryCommand);
    const queriedEntityIds = calls.map((call) => call.args[0].input.ExpressionAttributeValues[':entityId']);
    expect(queriedEntityIds.sort()).toEqual(['zone-01', ...DEFAULT_BAY_IDS].sort());
  });

  test('merges and sorts events from multiple entities newest-first', async () => {
    const older = { entityId: 'zone-01', type: 'flood_risk_event', timestamp: '2026-07-02T10:00:00.000Z' };
    const newer = { entityId: 'bay-01', type: 'bay_state_event', timestamp: '2026-07-02T10:05:00.000Z' };
    mockEntityResults({ 'zone-01': [older], 'bay-01': [newer] });

    const result = await handler({ pathParameters: { zoneId: 'zone-01' } });

    const body = JSON.parse(result.body);
    expect(body.events).toEqual([newer, older]);
    expect(body.count).toBe(2);
  });

  test('returns 400 when zoneId path parameter is missing', async () => {
    const result = await handler({ pathParameters: {} });
    expect(result.statusCode).toBe(400);
  });

  test('returns 200 with empty events array when no items exist', async () => {
    mockEntityResults({});

    const result = await handler({ pathParameters: { zoneId: 'zone-01' } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.events).toEqual([]);
    expect(body.count).toBe(0);
  });

  test('returns 500 when DynamoDB query fails', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('ddb unavailable'));

    const result = await handler({ pathParameters: { zoneId: 'zone-01' } });

    expect(result.statusCode).toBe(500);
  });
});
