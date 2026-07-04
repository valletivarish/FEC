const { mockClient } = require('aws-sdk-client-mock');
const { QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/dynamoClient');
const { handler, computeTariff } = require('../computeZonePricing/index');

const ddbMock = mockClient(docClient);

beforeEach(() => {
  ddbMock.reset();
});

function pressureItem(entryPressureEwma, timestamp = '2026-07-02T10:00:00.000Z') {
  return {
    entityId: 'zone-01',
    eventTypeTimestamp: `zone_pressure_event#${timestamp}`,
    type: 'zone_pressure_event',
    zoneId: 'zone-01',
    entryPressureEwma,
    timestamp,
  };
}

function tariffItem(newTariff, timestamp = '2026-07-02T09:00:00.000Z') {
  return {
    entityId: 'zone-01',
    eventTypeTimestamp: `tariff_changed#${timestamp}`,
    type: 'tariff_changed',
    previousTariff: 2.0,
    newTariff,
    demandSignal: 5,
    timestamp,
  };
}

describe('computeTariff formula', () => {
  test('returns the base rate at the neutral EWMA baseline', () => {
    expect(computeTariff(5)).toBe(2.0);
  });

  test('rises above base rate as demand pressure increases', () => {
    expect(computeTariff(15)).toBeCloseTo(3.0, 5);
  });

  test('falls below base rate when demand pressure is low', () => {
    expect(computeTariff(0)).toBeCloseTo(1.5, 5);
  });

  test('clamps to the maximum tariff under very high demand', () => {
    expect(computeTariff(1000)).toBe(6.0);
  });

  test('clamps to the minimum tariff under very low/negative demand', () => {
    expect(computeTariff(-1000)).toBe(1.0);
  });
});

describe('computeZonePricing handler', () => {
  test('writes no tariff_changed event when there is no zone_pressure_event yet', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await handler();

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(JSON.parse(result.body).tariffsChanged).toBe(0);
  });

  test('writes a tariff_changed event on the first ever pricing run', async () => {
    ddbMock
      .on(QueryCommand)
      .callsFake((input) => {
        if (input.ExpressionAttributeValues[':typePrefix'] === 'zone_pressure_event#') {
          return { Items: [pressureItem(20)] };
        }
        return { Items: [] };
      });

    const result = await handler();

    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    const item = putCalls[0].args[0].input.Item;
    expect(item.type).toBe('tariff_changed');
    expect(item.entityId).toBe('zone-01');
    expect(item.previousTariff).toBe(2.0);
    expect(item.newTariff).toBeCloseTo(3.5, 5);
    expect(item.demandSignal).toBe(20);
    expect(JSON.parse(result.body).tariffsChanged).toBe(1);
  });

  test('does not write a new event when the computed tariff has not genuinely moved', async () => {
    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.ExpressionAttributeValues[':typePrefix'] === 'zone_pressure_event#') {
        return { Items: [pressureItem(5)] };
      }
      return { Items: [tariffItem(2.0)] };
    });

    const result = await handler();

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(JSON.parse(result.body).tariffsChanged).toBe(0);
  });

  test('writes a new tariff_changed event when demand genuinely moves the price', async () => {
    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.ExpressionAttributeValues[':typePrefix'] === 'zone_pressure_event#') {
        return { Items: [pressureItem(25)] };
      }
      return { Items: [tariffItem(2.0)] };
    });

    const result = await handler();

    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    const item = putCalls[0].args[0].input.Item;
    expect(item.previousTariff).toBe(2.0);
    expect(item.newTariff).toBeCloseTo(4.0, 5);
    expect(JSON.parse(result.body).tariffsChanged).toBe(1);
  });
});
