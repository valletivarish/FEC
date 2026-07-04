'use strict';

const fs = require('fs');
const path = require('path');
const { ChargingHubSimulator, SensorChannel, METRIC_DEFINITIONS } = require('../chargingHubSimulator');

const configPath = path.join(__dirname, '..', 'config', 'hub-01.sensors.json');
const hubConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function makeFakeMqttClient() {
  return { publish: jest.fn() };
}

describe('hub config file', () => {
  test('defines independent sampleFrequencyMs and dispatchRateMs for all 10 metrics', () => {
    expect(Object.keys(hubConfig.sensors)).toHaveLength(10);
    for (const definition of METRIC_DEFINITIONS) {
      const rates = hubConfig.sensors[definition.key];
      expect(rates).toBeDefined();
      expect(typeof rates.sampleFrequencyMs).toBe('number');
      expect(typeof rates.dispatchRateMs).toBe('number');
      expect(rates.sampleFrequencyMs).toBeGreaterThan(0);
      expect(rates.dispatchRateMs).toBeGreaterThan(0);
    }
  });

  test('declares 6 bay ids as required by the domain contract', () => {
    expect(hubConfig.bayIds).toHaveLength(6);
  });
});

describe('SensorChannel dispatch cadence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('samples on sampleFrequencyMs but only dispatches once dispatchRateMs has elapsed', () => {
    const mqttClient = makeFakeMqttClient();
    const definition = METRIC_DEFINITIONS.find((d) => d.key === 'transformer-load-amps');
    const channel = new SensorChannel({
      hubId: 'hub-01',
      bayId: null,
      definition,
      sampleFrequencyMs: 1000,
      dispatchRateMs: 5000,
      mqttClient,
    });

    channel.start();

    // 4 samples in, still under the 5000ms dispatch rate: nothing published yet
    jest.advanceTimersByTime(4000);
    expect(mqttClient.publish).not.toHaveBeenCalled();

    // crossing the dispatch threshold triggers exactly one publish
    jest.advanceTimersByTime(1000);
    expect(mqttClient.publish).toHaveBeenCalledTimes(1);

    channel.stop();
  });

  test('a slower dispatchRateMs on one sensor does not affect a faster sensor sampled at the same frequency', () => {
    const fastMqtt = makeFakeMqttClient();
    const slowMqtt = makeFakeMqttClient();
    const definition = METRIC_DEFINITIONS.find((d) => d.key === 'feeder-voltage');

    const fastChannel = new SensorChannel({
      hubId: 'hub-01',
      bayId: null,
      definition,
      sampleFrequencyMs: 1000,
      dispatchRateMs: 1000,
      mqttClient: fastMqtt,
    });
    const slowChannel = new SensorChannel({
      hubId: 'hub-01',
      bayId: null,
      definition,
      sampleFrequencyMs: 1000,
      dispatchRateMs: 4000,
      mqttClient: slowMqtt,
    });

    fastChannel.start();
    slowChannel.start();

    jest.advanceTimersByTime(4000);

    expect(fastMqtt.publish).toHaveBeenCalledTimes(4);
    expect(slowMqtt.publish).toHaveBeenCalledTimes(1);

    fastChannel.stop();
    slowChannel.stop();
  });

  test('published payload matches the MQTT topic and body contract', () => {
    const mqttClient = makeFakeMqttClient();
    const definition = METRIC_DEFINITIONS.find((d) => d.key === 'bay-session-power');
    const channel = new SensorChannel({
      hubId: 'hub-01',
      bayId: 'bay-03',
      definition,
      sampleFrequencyMs: 500,
      dispatchRateMs: 500,
      mqttClient,
    });

    channel.start();
    jest.advanceTimersByTime(500);

    expect(mqttClient.publish).toHaveBeenCalledTimes(1);
    const [topic, body] = mqttClient.publish.mock.calls[0];
    expect(topic).toBe('gridpulse/hub-01/bay/session-power');

    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({
      hubId: 'hub-01',
      bayId: 'bay-03',
      metric: 'session-power',
      unit: 'kW',
    });
    expect(typeof parsed.value).toBe('number');
    expect(typeof parsed.timestamp).toBe('string');

    channel.stop();
  });
});

describe('ChargingHubSimulator wiring', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('creates one channel per bay for bay-scoped metrics and one shared channel for hub-scoped metrics', () => {
    const mqttClient = makeFakeMqttClient();
    const simulator = new ChargingHubSimulator(hubConfig, mqttClient);
    simulator.start();

    const bayScopedCount = METRIC_DEFINITIONS.filter((d) => d.scope === 'bay').length;
    const hubScopedCount = METRIC_DEFINITIONS.filter((d) => d.scope === 'hub').length;
    const expectedChannels = bayScopedCount * hubConfig.bayIds.length + hubScopedCount;

    expect(simulator.channels).toHaveLength(expectedChannels);

    simulator.stop();
  });

  test('stop() clears all timers so no further publishes occur', () => {
    const mqttClient = makeFakeMqttClient();
    const simulator = new ChargingHubSimulator(hubConfig, mqttClient);
    simulator.start();

    jest.advanceTimersByTime(1000);
    simulator.stop();
    mqttClient.publish.mockClear();

    jest.advanceTimersByTime(60000);
    expect(mqttClient.publish).not.toHaveBeenCalled();
  });
});
