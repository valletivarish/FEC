const BAY_TOPIC = 'parkfog/bay/+/+';
const ZONE_TOPIC = 'parkfog/zone/+/+';

function subscribeAll(mqttClient, onReading) {
  mqttClient.subscribe([BAY_TOPIC, ZONE_TOPIC]);

  mqttClient.on('message', (topic, payload) => {
    try {
      const reading = JSON.parse(payload.toString());
      onReading(reading);
    } catch {
      // malformed payloads are dropped so one bad message can't stall the subscriber
    }
  });
}

module.exports = { subscribeAll };
