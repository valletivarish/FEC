"""Self-reported runtime metrics for a fog node: counters, delay, CPU/memory, queue depth.

Each of the three fog nodes (FogParticulate, FogGases, FogComfort) owns one NodeStats
instance. CPU/memory come from psutil against the current process - since run_fog.py
runs all three nodes in a single process, those two figures are necessarily process-wide,
not per-node, and the dashboard should present them as "host process" figures rather than
imply per-node isolation that doesn't exist in this architecture.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Optional

import psutil

_DELAY_WINDOW = 50


def _parse_timestamp(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


class NodeStats:
    """Thread-safe counters and gauges for one fog node's real processing activity."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._lock = threading.Lock()
        self._received = 0
        self._processed = 0
        self._sent = 0
        self._delays_s: deque[float] = deque(maxlen=_DELAY_WINDOW)
        self._last_activity: Optional[float] = None
        self._process = psutil.Process()

    def record_received(self) -> None:
        with self._lock:
            self._received += 1
            self._last_activity = time.monotonic()

    def record_processed(self) -> None:
        with self._lock:
            self._processed += 1

    def record_dispatch(self, sensor_timestamp: str) -> None:
        """Processing delay = now minus the reading's own sensor timestamp."""
        with self._lock:
            self._sent += 1
            try:
                sensor_time = _parse_timestamp(sensor_timestamp)
                delay_s = (datetime.now(timezone.utc) - sensor_time).total_seconds()
                self._delays_s.append(max(0.0, delay_s))
            except (ValueError, TypeError):
                pass

    def snapshot(self, queue_size: int = 0) -> dict:
        """A point-in-time report combining real counters with a fresh CPU/memory sample."""
        with self._lock:
            received, processed, sent = self._received, self._processed, self._sent
            delays = list(self._delays_s)
            last_activity = self._last_activity

        avg_delay_ms = (sum(delays) / len(delays) * 1000.0) if delays else None
        idle_for_s = (time.monotonic() - last_activity) if last_activity is not None else None
        status = "running" if idle_for_s is not None and idle_for_s < 30.0 else "idle"

        return {
            "name": self.name,
            "status": status,
            "cpu_percent": self._process.cpu_percent(interval=None),
            "memory_mb": round(self._process.memory_info().rss / (1024 * 1024), 2),
            "messages_received": received,
            "messages_processed": processed,
            "messages_sent": sent,
            "processing_delay_ms": round(avg_delay_ms, 1) if avg_delay_ms is not None else None,
            "queue_size": queue_size,
        }
