// shared bounded random-walk step used by every metric generator
function boundedStep(previousValue, min, max, maxStep) {
  const start = typeof previousValue === 'number' ? previousValue : (min + max) / 2;
  const step = (Math.random() * 2 - 1) * maxStep;
  const next = start + step;
  return Math.min(max, Math.max(min, next));
}

module.exports = { boundedStep };
