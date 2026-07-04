from dispatcher import FleetEventDispatcher
from fog_engine import EngineFog, WINDOW_SIZE
from fog_safety import SafetyFog
from fog_sea_state import SeaStateFog

VESSEL_ID = 'vessel-01'


class RecordingDispatcher(FleetEventDispatcher):
    """Overrides dispatch to capture events instead of making real HTTP calls."""

    def __init__(self):
        super().__init__('http://unused.local', session=object())
        self.recorded = []

    def dispatch(self, event: dict) -> bool:
        self.recorded.append(event)
        return True


def test_engine_fog_events_are_dispatchable_with_expected_shape():
    fog = EngineFog()
    recorder = RecordingDispatcher()

    reading = {
        'vesselId': VESSEL_ID, 'metric': 'engine-vibration-raw',
        'value': 0.4, 'unit': 'g', 'timestamp': 't',
    }
    events = []
    for _ in range(WINDOW_SIZE):
        events = fog.on_reading(reading)
    for event in events:
        recorder.dispatch(event)

    assert len(recorder.recorded) == 1
    assert recorder.recorded[0]['type'] == 'engine_health_event'
    assert recorder.recorded[0]['vesselId'] == VESSEL_ID


def test_safety_fog_bilge_alarm_is_dispatchable_with_expected_shape():
    fog = SafetyFog()
    recorder = RecordingDispatcher()

    for level in (10, 20, 35, 55):
        for event in fog.on_reading({
            'vesselId': VESSEL_ID, 'metric': 'hull-bilge-level',
            'value': level, 'unit': 'mm', 'timestamp': 't',
        }):
            recorder.dispatch(event)

    # slope exceeds the threshold on both the 35 and 55 readings, so the still-active alarm redispatches
    assert len(recorder.recorded) == 2
    assert all(e['type'] == 'bilge_alarm' and e['alarmActive'] is True for e in recorder.recorded)


def test_sea_state_fog_event_is_dispatchable_with_expected_shape():
    fog = SeaStateFog()
    recorder = RecordingDispatcher()

    for roll in (5.0, -5.0):
        for event in fog.on_reading({
            'vesselId': VESSEL_ID, 'metric': 'nav-attitude',
            'value': {'pitchDeg': 0.0, 'rollDeg': roll}, 'unit': 'deg', 'timestamp': 't',
        }):
            recorder.dispatch(event)

    assert len(recorder.recorded) == 1
    assert recorder.recorded[0]['type'] == 'sea_state_event'
    assert recorder.recorded[0]['vesselId'] == VESSEL_ID
