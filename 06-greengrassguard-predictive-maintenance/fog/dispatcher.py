import requests


class DiagnosisDispatcher:
    """POSTs diagnosis events to the backend; never raises on transport failure
    since a fog node's diagnosis loop must keep running even if the backend is down."""

    def __init__(self, api_base_url: str, session=None):
        self.api_base_url = api_base_url.rstrip('/')
        self.session = session if session is not None else requests.Session()
        self._fallback = []

    def dispatch(self, event: dict) -> bool:
        url = f'{self.api_base_url}/diagnoses'
        try:
            response = self.session.post(url, json=event, timeout=5)
        except requests.exceptions.RequestException:
            self._fallback.append(event)
            return False

        if 200 <= response.status_code < 300:
            return True

        self._fallback.append(event)
        return False

    def drain_fallback(self) -> list:
        drained = self._fallback
        self._fallback = []
        return drained
