'use strict';

// contract: gridpulse/{hubId}/{category}/{metric}, body is the reading JSON verbatim
function publishReading(mqttClient, reading) {
  const topic = `gridpulse/${reading.hubId}/${reading.category}/${reading.metric}`;
  mqttClient.publish(topic, JSON.stringify(reading));
}

module.exports = { publishReading };
