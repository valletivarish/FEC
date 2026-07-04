import requests

from dispatcher import StationDispatcher


class StubResponse:
    def __init__(self, status_code):
        self.status_code = status_code


class StubSession:
    def __init__(self, status_code=200, raise_exc=None):
        self.status_code = status_code
        self.raise_exc = raise_exc
        self.posted = []

    def post(self, url, json=None, timeout=None):
        self.posted.append((url, json))
        if self.raise_exc:
            raise self.raise_exc
        return StubResponse(self.status_code)


def test_dispatch_success_posts_to_events_path_and_returns_true():
    session = StubSession(status_code=200)
    dispatcher = StationDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'weather_event'})

    assert result is True
    assert session.posted[0][0] == 'http://api.local/events'
    assert session.posted[0][1] == {'type': 'weather_event'}


def test_dispatch_2xx_boundary_values_return_true():
    for status in (200, 201, 204, 299):
        session = StubSession(status_code=status)
        dispatcher = StationDispatcher('http://api.local', session=session)
        assert dispatcher.dispatch({'type': 'x'}) is True


def test_dispatch_non_2xx_returns_false_and_falls_back():
    session = StubSession(status_code=503)
    dispatcher = StationDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'soil_event'})

    assert result is False
    assert dispatcher.drain_fallback() == [{'type': 'soil_event'}]


def test_dispatch_swallows_request_exception_and_falls_back():
    session = StubSession(raise_exc=requests.exceptions.ConnectionError('refused'))
    dispatcher = StationDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'pollution_event'})

    assert result is False
    assert dispatcher.drain_fallback() == [{'type': 'pollution_event'}]


def test_drain_fallback_empties_after_read():
    session = StubSession(status_code=500)
    dispatcher = StationDispatcher('http://api.local', session=session)
    dispatcher.dispatch({'type': 'a'})

    first = dispatcher.drain_fallback()
    second = dispatcher.drain_fallback()

    assert first == [{'type': 'a'}]
    assert second == []


def test_trailing_slash_on_base_url_is_normalized():
    session = StubSession(status_code=200)
    dispatcher = StationDispatcher('http://api.local/', session=session)

    dispatcher.dispatch({'type': 'x'})

    assert session.posted[0][0] == 'http://api.local/events'


def test_session_is_created_internally_when_not_provided():
    dispatcher = StationDispatcher('http://api.local')
    assert isinstance(dispatcher.session, requests.Session)


def test_subclass_can_override_dispatch_for_use_in_other_tests():
    class RecordingDispatcher(StationDispatcher):
        def __init__(self):
            self.calls = []

        def dispatch(self, event):
            self.calls.append(event)
            return True

    sub = RecordingDispatcher()
    assert sub.dispatch({'type': 'weather_event'}) is True
    assert sub.calls == [{'type': 'weather_event'}]
