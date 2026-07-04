from dispatcher import DiagnosisDispatcher


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


def test_dispatch_success_returns_true_and_posts_to_diagnoses_path():
    session = FakeSession(status_code=201)
    dispatcher = DiagnosisDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'vibe_fault'})

    assert result is True
    assert session.posted[0][0] == 'http://api.local/diagnoses'
    assert dispatcher.drain_fallback() == []


def test_dispatch_non_2xx_returns_false_and_falls_back():
    session = FakeSession(status_code=500)
    dispatcher = DiagnosisDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'thermal_event'})

    assert result is False
    assert dispatcher.drain_fallback() == [{'type': 'thermal_event'}]


def test_dispatch_swallows_request_exception():
    import requests

    session = FakeSession(raise_exc=requests.exceptions.ConnectionError('down'))
    dispatcher = DiagnosisDispatcher('http://api.local', session=session)

    result = dispatcher.dispatch({'type': 'hydraulic_event'})

    assert result is False
    assert dispatcher.drain_fallback() == [{'type': 'hydraulic_event'}]


def test_drain_fallback_empties_the_list():
    session = FakeSession(status_code=500)
    dispatcher = DiagnosisDispatcher('http://api.local', session=session)
    dispatcher.dispatch({'type': 'a'})

    first_drain = dispatcher.drain_fallback()
    second_drain = dispatcher.drain_fallback()

    assert first_drain == [{'type': 'a'}]
    assert second_drain == []


def test_subclass_can_override_dispatch():
    class RecordingDispatcher(DiagnosisDispatcher):
        def __init__(self):
            self.calls = []

        def dispatch(self, event):
            self.calls.append(event)
            return True

    sub = RecordingDispatcher()
    assert sub.dispatch({'type': 'vibe_fault'}) is True
    assert sub.calls == [{'type': 'vibe_fault'}]


def test_trailing_slash_in_base_url_is_normalized():
    session = FakeSession(status_code=200)
    dispatcher = DiagnosisDispatcher('http://api.local/', session=session)

    dispatcher.dispatch({'type': 'x'})

    assert session.posted[0][0] == 'http://api.local/diagnoses'
