function subscribeAll(mqttClient, onReading) {
  mqttClient.subscribe('greenhouseguard/+/+');
  mqttClient.on('message', (topic, payload) => {
    const reading = JSON.parse(payload.toString());
    onReading(reading);
  });
}

module.exports = { subscribeAll };
