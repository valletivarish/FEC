// Full wildcard covers all 4 categories (bay, transformer, feeder, der) under any hubId.
const TOPIC_WILDCARD = 'gridpulse/+/+/+';

function subscribeAll(mqttClient, onReading) {
  mqttClient.subscribe(TOPIC_WILDCARD);

  mqttClient.on('message', (topic, payload) => {
    try {
      const reading = JSON.parse(payload.toString());
      // fog agents match on the combined 'category/metric' form (e.g. 'bay/session-power'),
      // but sensors publish category and metric as separate fields — normalize once, here.
      reading.metric = `${reading.category}/${reading.metric}`;
      onReading(reading);
    } catch (err) {
      // A single malformed message must not take down the subscriber loop.
      console.error(`sensorSubscriber: failed to parse message on ${topic}:`, err);
    }
  });
}

module.exports = { subscribeAll };
