'use strict';

// topic pattern is the fog layer's only subscription filter, so it must match the contract exactly
function topicFor(reading) {
  return `officeiq/${reading.zoneId}/${reading.metric}`;
}

function publishReading(mqttClient, reading) {
  const topic = topicFor(reading);
  const payload = JSON.stringify(reading);
  mqttClient.publish(topic, payload);
}

module.exports = { publishReading, topicFor };
