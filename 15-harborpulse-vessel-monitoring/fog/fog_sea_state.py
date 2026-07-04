"""SeaStateFog: roll-motion and wind-derived sea state classification with adaptive cadence."""

ROLL_WINDOW_SIZE = 12
STABILITY_STREAK_THRESHOLD = 3
WIDENED_CADENCE = 3


class _VesselSeaState:
    def __init__(self):
        self.roll_window = []
        self.latest_wind_speed_kn = 0.0
        self.stability_streak = 0
        self.last_recompute_class = None
        self.last_dispatched_class = None
        self.recomputations_since_dispatch = 0


def _classify(score: float) -> str:
    if score < 5:
        return 'CALM'
    if score < 15:
        return 'LIGHT'
    if score < 30:
        return 'MODERATE'
    if score < 50:
        return 'ROUGH'
    return 'SEVERE'


class SeaStateFog:
    def __init__(self):
        self._vessels = {}

    def _state_for(self, vessel_id: str) -> _VesselSeaState:
        if vessel_id not in self._vessels:
            self._vessels[vessel_id] = _VesselSeaState()
        return self._vessels[vessel_id]

    def on_reading(self, reading: dict) -> list[dict]:
        metric = reading['metric']
        vessel_id = reading['vesselId']
        state = self._state_for(vessel_id)

        if metric == 'weather-wind-speed':
            state.latest_wind_speed_kn = reading['value']
        elif metric == 'nav-attitude':
            state.roll_window.append(reading['value']['rollDeg'])
            if len(state.roll_window) > ROLL_WINDOW_SIZE:
                state.roll_window.pop(0)
        else:
            return []

        if len(state.roll_window) < 2:
            return []

        roll_amplitude_deg = max(state.roll_window) - min(state.roll_window)
        zero_crossings = self._count_zero_crossings(state.roll_window)
        roll_period_estimate = len(state.roll_window) / max(1, zero_crossings / 2)

        sea_state_score = roll_amplitude_deg * 0.6 + state.latest_wind_speed_kn * 0.4
        sea_state_class = _classify(sea_state_score)

        should_dispatch = self._update_cadence(state, sea_state_class)
        if not should_dispatch:
            return []

        state.last_dispatched_class = sea_state_class
        return [{
            'type': 'sea_state_event',
            'vesselId': vessel_id,
            'seaStateClass': sea_state_class,
            'rollAmplitudeDeg': roll_amplitude_deg,
            'rollPeriodEstimate': roll_period_estimate,
            'meanWindSpeedKn': state.latest_wind_speed_kn,
            'timestamp': reading['timestamp'],
        }]

    @staticmethod
    def _count_zero_crossings(window: list) -> int:
        mean_val = sum(window) / len(window)
        signs = [1 if v > mean_val else (-1 if v < mean_val else 0) for v in window]
        crossings = 0
        previous_sign = None
        for sign in signs:
            if sign == 0:
                continue
            if previous_sign is not None and sign != previous_sign:
                crossings += 1
            previous_sign = sign
        return crossings

    @staticmethod
    def _update_cadence(state: _VesselSeaState, sea_state_class: str) -> bool:
        class_changed_since_recompute = (
            state.last_recompute_class is not None and sea_state_class == state.last_recompute_class
        )
        if class_changed_since_recompute:
            state.stability_streak += 1
        else:
            state.stability_streak = 0
        state.last_recompute_class = sea_state_class

        if sea_state_class != state.last_dispatched_class:
            state.recomputations_since_dispatch = 0
            return True

        if state.stability_streak < STABILITY_STREAK_THRESHOLD:
            state.recomputations_since_dispatch = 0
            return True

        state.recomputations_since_dispatch += 1
        if state.recomputations_since_dispatch >= WIDENED_CADENCE:
            state.recomputations_since_dispatch = 0
            return True
        return False
