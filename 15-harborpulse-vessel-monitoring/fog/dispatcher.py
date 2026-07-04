"""Shared HTTP dispatcher used by all HarborPulse fog nodes to push events to the backend."""
import requests

TELEMETRY_EVENT_TYPES = {'engine_health_event', 'sea_state_event', 'gps_track_event'}


class FleetEventDispatcher:
    def __init__(self, api_base_url: str, session=None):
        self.api_base_url = api_base_url.rstrip('/')
        self.session = session if session is not None else requests.Session()
        self._fallback = []

    def dispatch(self, event: dict) -> bool:
        path = '/telemetry' if event['type'] in TELEMETRY_EVENT_TYPES else '/alarms'
        url = f'{self.api_base_url}{path}'
        try:
            response = self.session.post(url, json=event, timeout=5)
        except requests.RequestException:
            self._fallback.append(event)
            return False

        if 200 <= response.status_code < 300:
            return True

        # a non-2xx response is still a delivery failure even though nothing raised
        self._fallback.append(event)
        return False

    def drain_fallback(self) -> list[dict]:
        drained = self._fallback
        self._fallback = []
        return drained
