'use strict';

// Single wildcard subscription keeps fog nodes decoupled from the zone/metric topic layout.
function subscribeAll(mqttClient, onReading) {
  mqttClient.subscribe('officeiq/+/+');
  mqttClient.on('message', (topic, payload) => {
    const reading = JSON.parse(payload.toString());
    onReading(reading);
  });
}

module.exports = { subscribeAll };
