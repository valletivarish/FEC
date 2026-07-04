const path = require("path");
const mqtt = require("mqtt");
const { loadConfig } = require("../../config/configLoader");
const { startSensorRunner } = require("./sensorRunner");

const electricityGenerator = require("./generators/electricityGenerator");
const waterFlowGenerator = require("./generators/waterFlowGenerator");
const temperatureGenerator = require("./generators/temperatureGenerator");
const humidityGenerator = require("./generators/humidityGenerator");
const lightLuxGenerator = require("./generators/lightLuxGenerator");
const co2Generator = require("./generators/co2Generator");
const doorContactGenerator = require("./generators/doorContactGenerator");
const motionGenerator = require("./generators/motionGenerator");
const soundLevelGenerator = require("./generators/soundLevelGenerator");
const ductPressureGenerator = require("./generators/ductPressureGenerator");

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

// Maps YAML topic keys to their generator function.
const GENERATORS = {
  electricity: electricityGenerator,
  "water-flow": waterFlowGenerator,
  temperature: temperatureGenerator,
  humidity: humidityGenerator,
  "light-lux": lightLuxGenerator,
  co2: co2Generator,
  "door-contact": doorContactGenerator,
  motion: motionGenerator,
  "sound-level": soundLevelGenerator,
  "hvac-duct-pressure": ductPressureGenerator,
};

// mqtt.js already retries on its own timer; this backoff only spaces out our log noise.
function connect() {
  const client = mqtt.connect(MQTT_BROKER_URL, {
    reconnectPeriod: 2000,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    console.log(`[sensors] connected to broker at ${MQTT_BROKER_URL}`);
  });

  client.on("reconnect", () => {
    console.warn("[sensors] reconnecting to broker...");
  });

  client.on("error", (err) => {
    console.error(`[sensors] mqtt error: ${err.message}`);
  });

  client.on("close", () => {
    console.warn("[sensors] connection closed");
  });

  return client;
}

function main() {
  const configPath = path.join(__dirname, "..", "..", "config", "sensors.campuspulse.yml");
  const { sensors, zones } = loadConfig(configPath);

  const client = connect();
  const stopFns = [];

  for (const zoneId of zones) {
    for (const [topic, { sampleFrequencyMs, dispatchRateMs }] of Object.entries(sensors)) {
      const generateNext = GENERATORS[topic];
      if (!generateNext) {
        throw new Error(`No generator registered for topic "${topic}"`);
      }

      const stop = startSensorRunner(zoneId, {
        topic,
        sampleFrequencyMs,
        dispatchRateMs,
        generateNext,
        onDispatch: (readings) => {
          const mqttTopic = `campuspulse/${zoneId}/${topic}`;
          client.publish(mqttTopic, JSON.stringify(readings), { qos: 0 });
        },
      });

      stopFns.push(stop);
    }
  }

  process.on("SIGINT", () => {
    console.log("[sensors] shutting down...");
    stopFns.forEach((stop) => stop());
    client.end();
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { main };
