// Sampling and dispatch run on independent intervals so slow topics (e.g. co2)
// can batch several samples per publish while fast topics (door/motion) publish sooner.

function startSensorRunner(zoneId, config) {
  const { topic, sampleFrequencyMs, dispatchRateMs, generateNext, onDispatch } = config;

  let lastValue;
  let buffer = [];

  const sampleTimer = setInterval(() => {
    lastValue = generateNext(lastValue);
    buffer.push({
      zoneId,
      topic,
      value: lastValue,
      timestamp: new Date().toISOString(),
    });
  }, sampleFrequencyMs);

  const dispatchTimer = setInterval(() => {
    if (buffer.length === 0) return;
    const readings = buffer;
    buffer = [];
    onDispatch(readings);
  }, dispatchRateMs);

  function stop() {
    clearInterval(sampleTimer);
    clearInterval(dispatchTimer);
  }

  return stop;
}

module.exports = { startSensorRunner };
