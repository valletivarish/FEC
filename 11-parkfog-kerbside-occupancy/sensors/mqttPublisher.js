'use strict';

// builds the exact topic pattern from the shared contract and publishes the reading as JSON
function publishReading(mqttClient, reading) {
  const topic =
    reading.scope === 'bay'
      ? `parkfog/bay/${reading.id}/${reading.metric}`
      : `parkfog/zone/${reading.id}/${reading.metric}`;

  mqttClient.publish(topic, JSON.stringify(reading));
  return topic;
}

module.exports = { publishReading };
