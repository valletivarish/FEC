'use strict';

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const { ZoneSensorRig } = require('./zoneSensorRig');

const ZONE_IDS = ['zone-101', 'zone-102', 'zone-201', 'zone-202'];
const CONFIG_DIR = path.join(__dirname, 'config');

function loadZoneConfig(zoneId) {
  const configPath = path.join(CONFIG_DIR, `${zoneId}.sensors.json`);
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function main() {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    throw new Error('MQTT_BROKER_URL is not set');
  }

  const mqttClient = mqtt.connect(brokerUrl);
  const rigs = [];

  mqttClient.on('connect', () => {
    for (const zoneId of ZONE_IDS) {
      const zoneConfig = loadZoneConfig(zoneId);
      const rig = new ZoneSensorRig(zoneConfig, mqttClient);
      rig.start();
      rigs.push(rig);
    }
  });

  // clean shutdown so timers don't keep the process alive after a stop signal
  process.on('SIGINT', () => {
    rigs.forEach((rig) => rig.stop());
    mqttClient.end();
    process.exit(0);
  });

  return { mqttClient, rigs };
}

if (require.main === module) {
  main();
}

module.exports = { main, loadZoneConfig, ZONE_IDS };
