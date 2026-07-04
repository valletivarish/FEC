'use strict';

const { routeReading } = require('../index');
const { OccupancyFog } = require('../fog-occupancy/reconcile');
const { ComfortFog } = require('../fog-comfort/ventilationAnomaly');
const { UsageFog } = require('../fog-usage/deviceLeftOn');
const { FakeZoneEventDispatcher } = require('./helpers/fakeDispatcher');

function makeNodes() {
  return { occupancyFog: new OccupancyFog(), comfortFog: new ComfortFog(), usageFog: new UsageFog() };
}

function reading(zoneId, metric, value, timestamp = 't0') {
  return { zoneId, metric, value, unit: 'x', timestamp };
}

describe('fog/index routeReading', () => {
  test('routes desk-occupancy to both OccupancyFog and UsageFog', async () => {
    const nodes = makeNodes();
    const dispatcher = new FakeZoneEventDispatcher();
    const spyOccupancy = jest.spyOn(nodes.occupancyFog, 'onReading');
    const spyUsage = jest.spyOn(nodes.usageFog, 'onReading');
    const spyComfort = jest.spyOn(nodes.comfortFog, 'onReading');

    await routeReading(reading('zone-101', 'desk-occupancy', 3), nodes, dispatcher);

    expect(spyOccupancy).toHaveBeenCalled();
    expect(spyUsage).toHaveBeenCalled();
    expect(spyComfort).not.toHaveBeenCalled();
  });

  test('routes people-counter only to OccupancyFog', async () => {
    const nodes = makeNodes();
    const dispatcher = new FakeZoneEventDispatcher();
    const spyOccupancy = jest.spyOn(nodes.occupancyFog, 'onReading');
    const spyUsage = jest.spyOn(nodes.usageFog, 'onReading');
    const spyComfort = jest.spyOn(nodes.comfortFog, 'onReading');

    await routeReading(reading('zone-101', 'people-counter', 5), nodes, dispatcher);

    expect(spyOccupancy).toHaveBeenCalled();
    expect(spyUsage).not.toHaveBeenCalled();
    expect(spyComfort).not.toHaveBeenCalled();
  });

  test('routes room-co2, window-state, room-humidity, pressure-differential only to ComfortFog', async () => {
    const nodes = makeNodes();
    const dispatcher = new FakeZoneEventDispatcher();
    const spyOccupancy = jest.spyOn(nodes.occupancyFog, 'onReading');
    const spyUsage = jest.spyOn(nodes.usageFog, 'onReading');
    const spyComfort = jest.spyOn(nodes.comfortFog, 'onReading');

    for (const metric of ['room-co2', 'window-state', 'room-humidity', 'pressure-differential']) {
      await routeReading(reading('zone-101', metric, 1), nodes, dispatcher);
    }

    expect(spyComfort).toHaveBeenCalledTimes(4);
    expect(spyOccupancy).not.toHaveBeenCalled();
    expect(spyUsage).not.toHaveBeenCalled();
  });

  test('routes plug-power and light-level only to UsageFog', async () => {
    const nodes = makeNodes();
    const dispatcher = new FakeZoneEventDispatcher();
    const spyOccupancy = jest.spyOn(nodes.occupancyFog, 'onReading');
    const spyUsage = jest.spyOn(nodes.usageFog, 'onReading');
    const spyComfort = jest.spyOn(nodes.comfortFog, 'onReading');

    await routeReading(reading('zone-101', 'plug-power', 20), nodes, dispatcher);
    await routeReading(reading('zone-101', 'light-level', 400), nodes, dispatcher);

    expect(spyUsage).toHaveBeenCalledTimes(2);
    expect(spyOccupancy).not.toHaveBeenCalled();
    expect(spyComfort).not.toHaveBeenCalled();
  });

  test('dispatches every event returned by the routed fog nodes', async () => {
    const nodes = makeNodes();
    const dispatcher = new FakeZoneEventDispatcher();

    await routeReading(reading('zone-101', 'desk-occupancy', 6), nodes, dispatcher);
    await routeReading(reading('zone-101', 'people-counter', 1), nodes, dispatcher);

    expect(dispatcher.dispatched).toHaveLength(1);
    expect(dispatcher.dispatched[0].type).toBe('occupancy_event');
  });
});
