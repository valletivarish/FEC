import requests

from dispatcher import FleetEventDispatcher


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


class FakeSession:
    def __init__(self, status_code=200, raise_exc=None):
        self.status_code = status_code
        self.raise_exc = raise_exc
        self.posted = []

    def post(self, url, json=None, timeout=None):
        self.posted.append((url, json))
        if self.raise_exc:
            raise self.raise_exc
        return FakeResponse(self.status_code)


def test_telemetry_event_types_go_to_telemetry_path():
    session = FakeSession(status_code=202)
    dispatcher = FleetEventDispatcher('http://api.local', session=session)

    for event_type in ('engine_health_event', 'sea_state_event', 'gps_track_event'):
        result = dispatcher.dispatch({'type': event_type})
        assert result is True

    assert all(url == 'http://api.local/telemetry' for url, _ in session.posted)


def test_bilge_alarm_goes_to_alarms_path():
    session = FakeSession(status_code=200)
    dispatcher = FleetEventDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'bilge_alarm', 'alarmActive': True})

    assert result is True
    assert session.posted[0][0] == 'http://api.local/alarms'


def test_non_2xx_response_returns_false_and_falls_back():
    session = FakeSession(status_code=503)
    dispatcher = FleetEventDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'gps_track_event'})

    assert result is False
    assert dispatcher.drain_fallback() == [{'type': 'gps_track_event'}]


def test_request_exception_is_caught_and_falls_back():
    session = FakeSession(raise_exc=requests.exceptions.ConnectionError('unreachable'))
    dispatcher = FleetEventDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'bilge_alarm'})

    assert result is False
    assert dispatcher.drain_fallback() == [{'type': 'bilge_alarm'}]


def test_drain_fallback_empties_after_reading():
    session = FakeSession(status_code=500)
    dispatcher = FleetEventDispatcher('http://api.local', session=session)
    dispatcher.dispatch({'type': 'sea_state_event'})

    first_drain = dispatcher.drain_fallback()
    second_drain = dispatcher.drain_fallback()

    assert len(first_drain) == 1
    assert second_drain == []


def test_trailing_slash_in_base_url_is_normalized():
    session = FakeSession(status_code=200)
    dispatcher = FleetEventDispatcher('http://api.local/', session=session)

    dispatcher.dispatch({'type': 'engine_health_event'})

    assert session.posted[0][0] == 'http://api.local/telemetry'
