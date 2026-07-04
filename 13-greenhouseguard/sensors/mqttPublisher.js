// topic shape is the fixed contract the fog layer subscribes against
function publishReading(mqttClient, reading) {
  const topic = `greenhouseguard/${reading.zoneId}/${reading.metric}`;
  mqttClient.publish(topic, JSON.stringify(reading));
}

module.exports = { publishReading };
