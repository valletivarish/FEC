const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// Topic name to env-var segment, e.g. "hvac-duct-pressure" -> "HVAC_DUCT_PRESSURE".
function topicToEnvSegment(topic) {
  return topic.toUpperCase().replace(/-/g, "_");
}

// File values are the baseline; env vars are an explicit per-topic override for local tuning.
function applyEnvOverrides(sensors) {
  const resolved = {};
  for (const [topic, block] of Object.entries(sensors)) {
    const segment = topicToEnvSegment(topic);
    const freqEnv = process.env[`CAMPUSPULSE_SENSOR_${segment}_FREQUENCY_MS`];
    const dispatchEnv = process.env[`CAMPUSPULSE_SENSOR_${segment}_DISPATCH_MS`];

    resolved[topic] = {
      sampleFrequencyMs: freqEnv !== undefined ? Number(freqEnv) : block.sampleFrequencyMs,
      dispatchRateMs: dispatchEnv !== undefined ? Number(dispatchEnv) : block.dispatchRateMs,
    };
  }
  return resolved;
}

function validate(sensors) {
  for (const [topic, block] of Object.entries(sensors)) {
    if (block.dispatchRateMs < block.sampleFrequencyMs) {
      throw new Error(
        `Invalid config for topic "${topic}": dispatchRateMs (${block.dispatchRateMs}) must be >= sampleFrequencyMs (${block.sampleFrequencyMs})`
      );
    }
  }
}

// Loads the YAML file, layers env overrides on top, then validates the result.
function loadConfig(configPath = path.join(__dirname, "sensors.campuspulse.yml")) {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(raw);

  const sensors = applyEnvOverrides(parsed.sensors);
  validate(sensors);

  return { sensors, zones: parsed.zones };
}

module.exports = { loadConfig, applyEnvOverrides, validate, topicToEnvSegment };
