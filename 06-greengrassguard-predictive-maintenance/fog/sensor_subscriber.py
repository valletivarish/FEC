import json

TOPIC_FILTER = 'greengrassguard/+/+'


def subscribe_all(mqtt_client, on_reading):
    """Wraps the client's on_message so any of the 10 metric topics land on one
    handler; fog nodes route by metric prefix rather than by topic string."""

    def _handle_message(client, userdata, message):
        reading = json.loads(message.payload)
        on_reading(reading)

    mqtt_client.on_message = _handle_message
    mqtt_client.subscribe(TOPIC_FILTER)
