"""Un-ionised ammonia and nitrite toxicity triage -- the Emerson equation only holds with fresh pH/temp/salinity."""

SAFE_MAX_UIA = 0.02
ELEVATED_MAX_UIA = 0.05
BROWN_BLOOD_NITRITE_THRESHOLD = 0.5


def _severity(uia_mg_per_l: float) -> str:
    if uia_mg_per_l < SAFE_MAX_UIA:
        return "safe"
    if uia_mg_per_l < ELEVATED_MAX_UIA:
        return "elevated"
    return "toxic"


class _PondState:
    def __init__(self):
        self.latest_ph = None
        self.latest_water_temperature = None
        self.latest_salinity = None
        self.latest_nitrite = None
        self.last_severity = None
        self.last_brown_blood_risk = False


class ToxicityFog:
    """Combines pH/temp/salinity/ammonia into UIA severity, plus an independent nitrite flag."""

    def __init__(self):
        self._ponds: dict[str, _PondState] = {}

    def _state_for(self, pond_id: str) -> _PondState:
        if pond_id not in self._ponds:
            self._ponds[pond_id] = _PondState()
        return self._ponds[pond_id]

    def on_reading(self, reading: dict) -> list[dict]:
        pond_id = reading["pondId"]
        metric = reading["metric"]
        state = self._state_for(pond_id)

        if metric == "ph":
            state.latest_ph = reading["value"]
            return []
        if metric == "water-temperature":
            state.latest_water_temperature = reading["value"]
            return []
        if metric == "salinity":
            state.latest_salinity = reading["value"]
            return []
        if metric == "nitrite-no2":
            state.latest_nitrite = reading["value"]
            return self._handle_nitrite(state, pond_id, reading)
        if metric != "ammonia-nh3-total":
            return []

        if state.latest_ph is None or state.latest_water_temperature is None:
            return []

        salinity = state.latest_salinity if state.latest_salinity is not None else 0.0
        pka, corrected_fraction, uia_mg_per_l = self._compute_uia(
            reading["value"], state.latest_ph, state.latest_water_temperature, salinity
        )
        severity = _severity(uia_mg_per_l)

        events = []
        if severity == "toxic":
            # toxic verdicts skip the transition gate entirely -- this must reach the cloud now
            events.append(
                self._event(pond_id, severity, uia_mg_per_l, state.last_brown_blood_risk, reading["timestamp"],
                             state.latest_ph, state.latest_water_temperature, salinity, pka, corrected_fraction,
                             state.latest_nitrite)
            )
        elif severity != state.last_severity:
            events.append(
                self._event(pond_id, severity, uia_mg_per_l, state.last_brown_blood_risk, reading["timestamp"],
                             state.latest_ph, state.latest_water_temperature, salinity, pka, corrected_fraction,
                             state.latest_nitrite)
            )
        state.last_severity = severity
        return events

    def _handle_nitrite(self, state: _PondState, pond_id: str, reading: dict) -> list[dict]:
        risk = reading["value"] > BROWN_BLOOD_NITRITE_THRESHOLD
        if risk == state.last_brown_blood_risk:
            state.last_brown_blood_risk = risk
            return []
        state.last_brown_blood_risk = risk

        severity = state.last_severity if state.last_severity is not None else "safe"
        ph = state.latest_ph if state.latest_ph is not None else 0.0
        temp = state.latest_water_temperature if state.latest_water_temperature is not None else 0.0
        salinity = state.latest_salinity if state.latest_salinity is not None else 0.0
        pka = 0.09018 + 2729.92 / (273.2 + temp) if temp is not None else 0.0
        return [
            self._event(pond_id, severity, 0.0, risk, reading["timestamp"], ph, temp, salinity, pka, 0.0,
                         state.latest_nitrite)
        ]

    @staticmethod
    def _compute_uia(total_ammonia_mg_per_l: float, ph: float, water_temperature: float, salinity: float):
        pka = 0.09018 + 2729.92 / (273.2 + water_temperature)
        fraction = 1 / (1 + 10 ** (pka - ph))
        corrected_fraction = fraction * (1 - 0.03 * min(salinity, 35) / 35)
        uia_mg_per_l = total_ammonia_mg_per_l * corrected_fraction
        return pka, corrected_fraction, uia_mg_per_l

    @staticmethod
    def _event(
        pond_id, severity, uia_mg_per_l, brown_blood_risk, timestamp, ph, temp, salinity, pka, corrected_fraction,
        nitrite
    ) -> dict:
        return {
            "type": "toxicity",
            "pond_id": pond_id,
            "severity": severity,
            "uia_mg_per_l": uia_mg_per_l,
            "nitrite_brown_blood_risk": brown_blood_risk,
            "provenance": {
                "ph": ph,
                "water_temperature": temp,
                "salinity": salinity,
                "pka": pka,
                "corrected_fraction": corrected_fraction,
                # raw reading behind the brown-blood-risk flag, not just its derived boolean
                "nitrite_no2": nitrite,
            },
            "timestamp": timestamp,
        }
