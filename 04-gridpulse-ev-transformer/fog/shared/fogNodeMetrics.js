// Real per-agent operational counters + timing, sampled by the status server for the dashboard.
// Nothing here is synthetic: every count increments on a genuine event, delay is measured from
// the reading's own sensor timestamp to the moment this process dispatches its resulting event.
class FogNodeMetrics {
  constructor(nodeName) {
    this.nodeName = nodeName;
    this.messagesReceived = 0;
    this.messagesProcessed = 0;
    this.messagesSent = 0;
    this.lastProcessingDelayMs = null;
    this.pendingDispatchCount = 0;
    this.startedAt = Date.now();
  }

  recordReceived() {
    this.messagesReceived += 1;
  }

  // call once the agent has actually run its processing logic on the reading (not pass-through)
  recordProcessed() {
    this.messagesProcessed += 1;
  }

  // sensorTimestamp is the reading's own ISO timestamp; dispatchedAt defaults to now
  recordDispatchStart(sensorTimestamp, dispatchedAt = Date.now()) {
    this.pendingDispatchCount += 1;
    if (sensorTimestamp) {
      this.lastProcessingDelayMs = Math.max(0, dispatchedAt - new Date(sensorTimestamp).getTime());
    }
  }

  recordDispatchSettled() {
    this.messagesSent += 1;
    this.pendingDispatchCount = Math.max(0, this.pendingDispatchCount - 1);
  }

  snapshot() {
    return {
      nodeName: this.nodeName,
      status: this.messagesReceived > 0 ? 'running' : 'idle',
      messagesReceived: this.messagesReceived,
      messagesProcessed: this.messagesProcessed,
      messagesSent: this.messagesSent,
      processingDelayMs: this.lastProcessingDelayMs,
      queueSize: this.pendingDispatchCount,
      uptimeMs: Date.now() - this.startedAt,
    };
  }
}

module.exports = { FogNodeMetrics };
