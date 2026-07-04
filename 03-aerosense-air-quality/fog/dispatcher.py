"""HTTP dispatch of advisories to the backend, with retry and offline fallback."""
from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Optional

import requests

from advisory import Advisory

logger = logging.getLogger(__name__)

_RETRY_BACKOFFS_S = (0.2, 0.4, 0.8)
_FALLBACK_MAXLEN = 200
_REPLAY_INTERVAL_S = 30.0


class AdvisoryDispatcher:
    """Posts advisories to the ingest API and buffers them locally if it is unreachable."""

    def __init__(self, api_base_url: str, session: Optional[requests.Session] = None) -> None:
        self._url = f"{api_base_url.rstrip('/')}/advisories"
        self._session = session or requests.Session()
        self._fallback: deque[Advisory] = deque(maxlen=_FALLBACK_MAXLEN)
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self._start_replay_timer()

    def dispatch(self, advisory: Advisory) -> bool:
        """Attempt delivery with bounded retries; queue for later replay on failure."""
        if self._send(advisory):
            return True
        with self._lock:
            self._fallback.append(advisory)
        return False

    def drain_fallback(self) -> list[Advisory]:
        """Pop and return everything currently queued, for inspection or manual replay."""
        with self._lock:
            drained = list(self._fallback)
            self._fallback.clear()
        return drained

    def pending_count(self) -> int:
        """Real in-memory backlog size, for dashboard queue-depth reporting."""
        with self._lock:
            return len(self._fallback)

    def _send(self, advisory: Advisory) -> bool:
        for attempt, backoff in enumerate((0.0,) + _RETRY_BACKOFFS_S):
            if backoff:
                time.sleep(backoff)
            try:
                response = self._session.post(self._url, json=advisory.to_dict(), timeout=5)
                if response.status_code < 500:
                    return response.ok
            except requests.RequestException as exc:
                logger.warning("advisory post attempt %d failed: %s", attempt + 1, exc)
        return False

    def _start_replay_timer(self) -> None:
        # Daemon so the interpreter can exit without an explicit shutdown call.
        self._timer = threading.Timer(_REPLAY_INTERVAL_S, self._replay_fallback)
        self._timer.daemon = True
        self._timer.start()

    def _replay_fallback(self) -> None:
        pending = self.drain_fallback()
        for advisory in pending:
            if not self._send(advisory):
                with self._lock:
                    self._fallback.append(advisory)
        self._start_replay_timer()

    def stop(self) -> None:
        """Cancel the background replay timer, mainly useful in tests."""
        if self._timer is not None:
            self._timer.cancel()
