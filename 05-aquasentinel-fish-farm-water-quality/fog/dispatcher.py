"""Shared HTTP dispatcher used by all fog nodes to push triaged events to the cloud backend."""
import logging

import requests

logger = logging.getLogger(__name__)


class AlertDispatcher:
    """Routes fog events to the correct backend endpoint and never lets a POST failure crash a fog node."""

    def __init__(self, api_base_url: str, session=None):
        self.api_base_url = api_base_url.rstrip("/")
        self.session = session if session is not None else requests.Session()
        self._fallback = []

    def _endpoint_for(self, event: dict) -> str:
        # toxicity events that are actually urgent get their own higher-priority path
        is_urgent_toxicity = event.get("type") == "toxicity" and (
            event.get("severity") == "toxic" or event.get("nitrite_brown_blood_risk") is True
        )
        if is_urgent_toxicity:
            return f"{self.api_base_url}/alerts"
        return f"{self.api_base_url}/readings"

    def dispatch(self, event: dict) -> bool:
        url = self._endpoint_for(event)
        try:
            response = self.session.post(url, json=event, timeout=5)
            if 200 <= response.status_code < 300:
                return True
            logger.warning("dispatch to %s returned status %s", url, response.status_code)
        except requests.exceptions.RequestException:
            logger.exception("dispatch to %s failed", url)
        self._fallback.append(event)
        return False

    def drain_fallback(self) -> list:
        drained, self._fallback = self._fallback, []
        return drained
