"""Self-reported operational health for one fog node's slice of the shared process.

All three GreenGrid fog nodes (WeatherFog, SoilFog, PollutionFog) run in the same
`fog.main` process, so CPU/memory are read once per process via psutil and shared
across node reports — a real process-level measurement, not a fabricated per-node split.
Everything else (counters, queue depth, processing delay) is tracked per node instance,
since each node ingests/processes/dispatches its own subset of readings independently.
"""
import time
from collections import deque
from datetime import datetime, timezone

import psutil

_PROCESS = psutil.Process()
# first call always returns 0.0 per psutil's docs; warms the internal sample window
# so the first real dashboard poll after startup already reports a meaningful value
_PROCESS.cpu_percent(interval=None)

MAX_QUEUE_DEPTH = 100


def _parse_timestamp(timestamp: str) -> float:
    return datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp()


class FogNodeHealth:
    """Tracks one fog node's real throughput counters, in-memory queue depth, and
    end-to-end processing delay (sensor timestamp -> dispatch time)."""

    def __init__(self, node_name: str, station_ids: list):
        self.node_name = node_name
        self.station_ids = station_ids
        self.messages_received = 0
        self.messages_processed = 0
        self.messages_sent = 0
        self._queue = deque(maxlen=MAX_QUEUE_DEPTH)
        self._last_delay_ms = None
        self._last_activity_monotonic = None

    def record_received(self) -> None:
        self.messages_received += 1
        self._queue.append(time.monotonic())
        self._last_activity_monotonic = time.monotonic()

    def record_processed(self, events_emitted: int) -> None:
        self.messages_processed += 1
        if self._queue:
            self._queue.popleft()

    def record_dispatched(self, reading_timestamp: str, count: int = 1) -> None:
        self.messages_sent += count
        try:
            sensor_time = _parse_timestamp(reading_timestamp)
            self._last_delay_ms = max(0.0, (time.time() - sensor_time) * 1000.0)
        except (ValueError, TypeError):
            # a malformed timestamp must not crash health reporting; keep last-known delay
            pass

    @property
    def queue_size(self) -> int:
        return len(self._queue)

    @property
    def status(self) -> str:
        if self._last_activity_monotonic is None:
            return "idle"
        # no reading ingested in the last 30s means the node has gone quiet, not necessarily broken
        if time.monotonic() - self._last_activity_monotonic > 30:
            return "idle"
        return "running"

    def snapshot(self) -> dict:
        cpu_percent = _PROCESS.cpu_percent(interval=None)
        memory_mb = _PROCESS.memory_info().rss / (1024 * 1024)

        return {
            "node_name": self.node_name,
            "status": self.status,
            "cpu_percent": round(cpu_percent, 2),
            "memory_mb": round(memory_mb, 2),
            "messages_received": self.messages_received,
            "messages_processed": self.messages_processed,
            "messages_sent": self.messages_sent,
            "processing_delay_ms": round(self._last_delay_ms, 1) if self._last_delay_ms is not None else None,
            "queue_size": self.queue_size,
        }

    def to_health_event(self, timestamp: str) -> dict:
        """Shapes the snapshot as a dispatchable event, reusing the exact same
        HTTP -> SQS -> DynamoDB path every other GreenGrid event takes."""
        event = dict(self.snapshot())
        event["type"] = "node_health"
        # fog nodes are domain processors, not station-scoped, but the readings table's
        # partition key is station_id — the node's own name doubles as that key here
        event["station_id"] = f"fog-{self.node_name}"
        event["timestamp"] = timestamp
        return event
