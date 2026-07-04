"""Shared test double: a subclass of the real dispatcher so tests never touch HTTP."""
from fog.dispatcher import AlertDispatcher


class RecordingDispatcher(AlertDispatcher):
    def __init__(self):
        super().__init__(api_base_url="http://unused.invalid")
        self.dispatched = []

    def dispatch(self, event: dict) -> bool:
        self.dispatched.append(event)
        return True
