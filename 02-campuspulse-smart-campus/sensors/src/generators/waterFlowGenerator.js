// Water flow sits near zero most of the time with occasional usage bursts.
const MIN = 0;
const MAX = 25;
const STEP = 2;

module.exports = function waterFlowGenerator(previousValue) {
  const base = typeof previousValue === "number" ? previousValue : 0;
  const delta = (Math.random() - 0.5) * 2 * STEP;
  return Math.min(MAX, Math.max(MIN, base + delta));
};
