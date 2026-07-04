'use strict';

const mqtt = require('mqtt');

const TOPIC_FILTER = 'campuspulse/+/#';

// Sensor topics are campuspulse/{zoneId}/{topic}; extract both from the wildcard match.
function parseTopic(topic) {
  const parts = topic.split('/');
  if (parts.length < 3 || parts[0] !== 'campuspulse') {
    return null;
  }
  const zoneId = parts[1];
  const sensorTopic = parts.slice(2).join('/');
  return { zoneId, sensorTopic };
}

// Connects to the broker and forwards every parsed reading to onReading.
function subscribeToReadings(mqttBrokerUrl, onReading) {
  const client = mqtt.connect(mqttBrokerUrl);

  client.on('connect', () => {
    client.subscribe(TOPIC_FILTER);
  });

  client.on('message', (topic, payloadBuf) => {
    const parsedTopic = parseTopic(topic);
    if (!parsedTopic) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(payloadBuf.toString());
    } catch {
      return;
    }
    const reading = {
      zoneId: payload.zoneId || parsedTopic.zoneId,
      topic: payload.topic || parsedTopic.sensorTopic,
      value: payload.value,
      timestamp: payload.timestamp
    };
    onReading(reading);
  });

  return client;
}

module.exports = { subscribeToReadings };
