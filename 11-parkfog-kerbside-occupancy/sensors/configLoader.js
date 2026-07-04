'use strict';

const fs = require('fs');

// centralizes config parsing so both index.js and tests read the same shape/validation
function loadSensorConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed.zoneId || !Array.isArray(parsed.bays)) {
    throw new Error('sensor config must define zoneId and a bays array');
  }
  if (!parsed.bayMetrics || !parsed.zoneMetrics) {
    throw new Error('sensor config must define bayMetrics and zoneMetrics timing maps');
  }

  return parsed;
}

module.exports = { loadSensorConfig };
