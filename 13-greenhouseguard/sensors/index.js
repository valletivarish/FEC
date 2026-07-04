const mqtt = require('mqtt');
const { GreenhouseSensorRig } = require('./greenhouseSensorRig');

const ZONE_IDS = ['zone-a', 'zone-b', 'zone-c'];
const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

const mqttClient = mqtt.connect(brokerUrl);

mqttClient.on('connect', () => {
  const rigs = ZONE_IDS.map((zoneId) => {
    const rig = new GreenhouseSensorRig(zoneId, mqttClient);
    rig.start();
    return rig;
  });

  process.on('SIGINT', () => {
    rigs.forEach((rig) => rig.stop());
    mqttClient.end();
    process.exit(0);
  });
});

mqttClient.on('error', (err) => {
  console.error('MQTT connection error:', err.message);
});
