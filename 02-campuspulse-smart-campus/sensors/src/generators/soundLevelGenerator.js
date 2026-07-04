// Ambient sound wanders within a room-noise-floor-to-chatter range.
const MIN = 25;
const MAX = 95;
const STEP = 4;

module.exports = function soundLevelGenerator(previousValue) {
  const base = typeof previousValue === "number" ? previousValue : 40;
  const delta = (Math.random() - 0.5) * 2 * STEP;
  return Math.min(MAX, Math.max(MIN, base + delta));
};
