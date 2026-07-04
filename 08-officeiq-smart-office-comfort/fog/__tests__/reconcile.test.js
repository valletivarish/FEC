'use strict';

const { OccupancyFog } = require('../fog-occupancy/reconcile');

function deskReading(zoneId, value, timestamp = '2026-01-01T00:00:00.000Z') {
  return { zoneId, metric: 'desk-occupancy', value, unit: 'count', timestamp };
}

function peopleReading(zoneId, value, timestamp = '2026-01-01T00:00:00.000Z') {
  return { zoneId, metric: 'people-counter', value, unit: 'count', timestamp };
}

describe('OccupancyFog discrepancy classification', () => {
  test('desks occupied but people-counter disagrees yields SENSOR_DRIFT', () => {
    const fog = new OccupancyFog();
    fog.onReading(deskReading('zone-101', 6));
    const events = fog.onReading(peopleReading('zone-101', 2));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'occupancy_event',
      zoneId: 'zone-101',
      verdict: 'SENSOR_DRIFT',
      deskOccupiedCount: 6,
      netPeopleCount: 2,
    });
  });

  test('more people counted than desks show occupied yields STANDING_ROOM', () => {
    const fog = new OccupancyFog();
    fog.onReading(deskReading('zone-101', 2));
    const events = fog.onReading(peopleReading('zone-101', 6));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      verdict: 'STANDING_ROOM',
      deskOccupiedCount: 2,
      netPeopleCount: 6,
    });
  });

  test('discrepancy below threshold of 3 does not dispatch', () => {
    const fog = new OccupancyFog();
    fog.onReading(deskReading('zone-101', 4));
    const events = fog.onReading(peopleReading('zone-101', 2));

    expect(events).toEqual([]);
  });

  test('every discrepancy occurrence dispatches, not just transitions', () => {
    const fog = new OccupancyFog();
    fog.onReading(deskReading('zone-101', 6));
    const first = fog.onReading(peopleReading('zone-101', 1));
    const second = fog.onReading(peopleReading('zone-101', 1));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  test('resolvedHeadcount averages before the 3-consecutive-streak threshold', () => {
    const fog = new OccupancyFog();
    fog.onReading(deskReading('zone-101', 6));
    const first = fog.onReading(peopleReading('zone-101', 2));
    expect(first[0].resolvedHeadcount).toBe(Math.round((6 + 2) / 2));

    const second = fog.onReading(peopleReading('zone-101', 2));
    expect(second[0].resolvedHeadcount).toBe(Math.round((6 + 2) / 2));
  });

  test('resolvedHeadcount biases to netPeopleCount after 3 consecutive same-verdict readings', () => {
    const fog = new OccupancyFog();
    fog.onReading(deskReading('zone-101', 6));
    fog.onReading(peopleReading('zone-101', 2));
    fog.onReading(peopleReading('zone-101', 2));
    const third = fog.onReading(peopleReading('zone-101', 2));

    expect(third[0].resolvedHeadcount).toBe(2);
  });

  test('a differing verdict direction resets the consecutive streak', () => {
    const fog = new OccupancyFog();
    fog.onReading(deskReading('zone-101', 6));
    fog.onReading(peopleReading('zone-101', 2)); // SENSOR_DRIFT streak 1
    fog.onReading(peopleReading('zone-101', 2)); // SENSOR_DRIFT streak 2

    // flip to STANDING_ROOM, breaking the SENSOR_DRIFT streak
    fog.onReading(deskReading('zone-101', 1));
    const flipped = fog.onReading(peopleReading('zone-101', 6));
    expect(flipped[0].verdict).toBe('STANDING_ROOM');
    expect(flipped[0].resolvedHeadcount).toBe(Math.round((1 + 6) / 2));

    // back to SENSOR_DRIFT — streak should have restarted, not continued from before
    fog.onReading(deskReading('zone-101', 6));
    const backToDrift = fog.onReading(peopleReading('zone-101', 2));
    expect(backToDrift[0].resolvedHeadcount).toBe(Math.round((6 + 2) / 2));
  });

  test('zones are tracked independently', () => {
    const fog = new OccupancyFog();
    fog.onReading(deskReading('zone-101', 6));
    fog.onReading(peopleReading('zone-101', 1));
    const zone202 = fog.onReading(deskReading('zone-202', 1));

    expect(zone202).toEqual([]);
  });
});
