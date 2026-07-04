const { PutRecordCommand } = require('@aws-sdk/client-kinesis');

// Concrete (not abstract) so unit/integration tests can subclass and override dispatch directly.
class KinesisDispatchClient {
  constructor(kinesisClient, streamName) {
    this.kinesisClient = kinesisClient;
    this.streamName = streamName;
  }

  async dispatch(event) {
    try {
      const command = new PutRecordCommand({
        Data: Buffer.from(JSON.stringify(event)),
        PartitionKey: event.hubId,
        StreamName: this.streamName,
      });
      await this.kinesisClient.send(command);
      return true;
    } catch (err) {
      // Swallow so a single dispatch failure never crashes a fog agent's processing loop.
      console.error('KinesisDispatchClient dispatch failed:', err);
      return false;
    }
  }
}

module.exports = { KinesisDispatchClient };
