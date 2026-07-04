const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, 'config');

// each zone's timing config is a standalone JSON file so a zone can be
// retuned without touching the others
function loadZoneConfig(zoneId) {
  const configPath = path.join(CONFIG_DIR, `${zoneId}.sensors.json`);
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

module.exports = { loadZoneConfig, CONFIG_DIR };
