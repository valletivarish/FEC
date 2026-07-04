'use strict';

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const { ChargingHubSimulator } = require('./chargingHubSimulator');

const brokerUrl = process.env.MQTT_BROKER_URL;
if (!brokerUrl) {
  throw new Error('MQTT_BROKER_URL environment variable is required');
}

const configFile = process.env.HUB_CONFIG_FILE || path.join(__dirname, 'config', 'hub-01.sensors.json');
const hubConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));

const mqttClient = mqtt.connect(brokerUrl);

mqttClient.on('connect', () => {
  const simulator = new ChargingHubSimulator(hubConfig, mqttClient);
  simulator.start();
  console.log(`GridPulse sensor simulator started for ${hubConfig.hubId} against ${brokerUrl}`);
});

mqttClient.on('error', (err) => {
  console.error('MQTT connection error', err);
});
