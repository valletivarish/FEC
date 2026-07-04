'use strict';

const { ZoneEventDispatcher } = require('../../shared/zoneEventDispatcher');

// records dispatched events in-memory instead of issuing real HTTP calls
class FakeZoneEventDispatcher extends ZoneEventDispatcher {
  constructor() {
    super('http://fake.local');
    this.dispatched = [];
  }

  async dispatch(event) {
    this.dispatched.push(event);
    return true;
  }
}

module.exports = { FakeZoneEventDispatcher };
