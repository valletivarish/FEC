const { startSensorRunner } = require("../src/sensorRunner");

describe("sensorRunner", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("dispatches at the configured dispatchRateMs, not on every sample", () => {
    const onDispatch = jest.fn();
    const generateNext = jest.fn((prev) => (typeof prev === "number" ? prev + 1 : 1));

    const stop = startSensorRunner("zone-a", {
      topic: "electricity",
      sampleFrequencyMs: 1000,
      dispatchRateMs: 5000,
      generateNext,
      onDispatch,
    });

    jest.advanceTimersByTime(4999);
    expect(onDispatch).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onDispatch).toHaveBeenCalledTimes(1);

    const firstBatch = onDispatch.mock.calls[0][0];
    expect(firstBatch).toHaveLength(5);
    expect(firstBatch[0]).toMatchObject({ zoneId: "zone-a", topic: "electricity" });

    stop();
  });

  test("sample and dispatch rates are independently configurable", () => {
    const onDispatch = jest.fn();
    const generateNext = jest.fn(() => 42);

    const stop = startSensorRunner("zone-b", {
      topic: "motion",
      sampleFrequencyMs: 1000,
      dispatchRateMs: 5000,
      generateNext,
      onDispatch,
    });

    jest.advanceTimersByTime(5000);
    expect(generateNext).toHaveBeenCalledTimes(5);
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch.mock.calls[0][0]).toHaveLength(5);

    stop();
  });

  test("stop() clears both timers so no further activity occurs", () => {
    const onDispatch = jest.fn();
    const generateNext = jest.fn(() => 1);

    const stop = startSensorRunner("zone-c", {
      topic: "co2",
      sampleFrequencyMs: 1000,
      dispatchRateMs: 3000,
      generateNext,
      onDispatch,
    });

    jest.advanceTimersByTime(3000);
    const callsBeforeStop = onDispatch.mock.calls.length;

    stop();
    jest.advanceTimersByTime(10000);

    expect(onDispatch.mock.calls.length).toBe(callsBeforeStop);
  });

  test("skips dispatch when the buffer is empty", () => {
    const onDispatch = jest.fn();
    const generateNext = jest.fn(() => 1);

    const stop = startSensorRunner("zone-a", {
      topic: "door-contact",
      sampleFrequencyMs: 10000,
      dispatchRateMs: 2000,
      generateNext,
      onDispatch,
    });

    jest.advanceTimersByTime(2000);
    expect(onDispatch).not.toHaveBeenCalled();

    stop();
  });
});
