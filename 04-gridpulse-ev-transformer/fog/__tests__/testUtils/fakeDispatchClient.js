const { KinesisDispatchClient } = require('../../shared/kinesisDispatchClient');

// Subclass to capture dispatched events without touching real AWS, per the contract's testability requirement.
class FakeDispatchClient extends KinesisDispatchClient {
  constructor() {
    super({}, 'fake-stream');
    this.dispatched = [];
  }

  async dispatch(event) {
    this.dispatched.push(event);
    return true;
  }
}

module.exports = { FakeDispatchClient };
