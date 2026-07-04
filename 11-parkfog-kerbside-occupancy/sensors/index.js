'use strict';

const path = require('path');
const mqtt = require('mqtt');
const { loadSensorConfig } = require('./configLoader');
const { KerbSensorRig } = require('./kerbSensorRig');

const brokerUrl = process.env.MQTT_BROKER_URL;
if (!brokerUrl) {
  throw new Error('MQTT_BROKER_URL env var is required to start the sensor rig');
}

const configPath = path.join(__dirname, 'config', 'zone-01.sensors.json');
const config = loadSensorConfig(configPath);

const mqttClient = mqtt.connect(brokerUrl);

mqttClient.on('connect', () => {
  const rig = new KerbSensorRig(config, mqttClient);
  rig.start();
  console.log(`ParkFog sensor rig running for ${config.zoneId} against ${brokerUrl}`);
});

mqttClient.on('error', (err) => {
  console.error('MQTT connection error', err);
});
