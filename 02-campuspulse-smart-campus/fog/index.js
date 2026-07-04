'use strict';

const { startFogEnergyNode } = require('./fog-energy');
const { startFogEnvironmentNode } = require('./fog-environment');
const { startFogSecurityNode } = require('./fog-security');

// Local dev / single-process entrypoint: `node fog/index.js` runs all 3 fog nodes together.
function main() {
  const mqttBrokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!apiBaseUrl) {
    throw new Error('API_BASE_URL environment variable is required to dispatch fog events');
  }

  const energyNode = startFogEnergyNode({ mqttBrokerUrl, apiBaseUrl });
  const environmentNode = startFogEnvironmentNode({ mqttBrokerUrl, apiBaseUrl });
  const securityNode = startFogSecurityNode({ mqttBrokerUrl, apiBaseUrl });

  console.log(`fog-energy, fog-environment, fog-security nodes started against ${mqttBrokerUrl}`);

  const shutdown = () => {
    energyNode.stop();
    environmentNode.stop();
    securityNode.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main();
}

module.exports = { main };
