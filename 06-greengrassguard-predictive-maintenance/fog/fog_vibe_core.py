import numpy as np

WINDOW_SIZE = 32
VIBE_METRICS = ('vibe-axial', 'vibe-radial')
EWMA_ALPHA = 0.05
ANOMALY_THRESHOLD = 3.5
CONSECUTIVE_BREACHES_REQUIRED = 2
BANDS = ('low', 'mid', 'high')

# Acoustic emission corroborates bearing/vibration faults (both stem from surface
# contact) but is far cheaper to sample than an FFT, so it gets a simple threshold
# rather than a spectral analysis of its own.
ACOUSTIC_ADVISORY_THRESHOLD_DB = 85.0
ACOUSTIC_CORROBORATION_THRESHOLD_DB = 95.0


class VibeCore:
    """Keeps raw waveform samples entirely on the edge; only band-energy verdicts
    ever leave this class, satisfying the never-forward-raw-window contract."""

    def __init__(self):
        self._windows = {}
        self._baselines = {}
        self._breach_counts = {}
        self._latest_acoustic_emission = {}

    def _state_for(self, asset_id, metric):
        key = (asset_id, metric)
        if key not in self._windows:
            self._windows[key] = []
            self._baselines[key] = {band: None for band in BANDS}
            self._breach_counts[key] = {band: 0 for band in BANDS}
        return key

    def _band_energies(self, samples):
        n = len(samples)
        hann = np.array([0.5 - 0.5 * np.cos(2 * np.pi * i / (n - 1)) for i in range(n)])
        windowed = np.array(samples) * hann
        rms = np.sqrt(np.mean(windowed ** 2))

        spectrum = np.fft.rfft(windowed)
        power = np.abs(spectrum) ** 2
        n_bins = len(power)
        third = n_bins // 3

        low = power[0:third]
        mid = power[third:2 * third]
        high = power[2 * third:n_bins]

        return rms, {
            'low': float(np.sum(low)),
            'mid': float(np.sum(mid)),
            'high': float(np.sum(high)),
        }

    def on_reading(self, reading: dict) -> list:
        metric = reading.get('metric')

        if metric == 'acoustic-emission':
            return self._on_acoustic_emission(reading)

        if metric not in VIBE_METRICS:
            return []

        asset_id = reading['assetId']
        window_samples = reading.get('window')
        if not window_samples:
            return []

        key = self._state_for(asset_id, metric)
        buf = self._windows[key]
        buf.extend(window_samples)
        if len(buf) < WINDOW_SIZE:
            return []

        current_window = buf[:WINDOW_SIZE]
        del buf[:WINDOW_SIZE]

        _, energies = self._band_energies(current_window)

        baselines = self._baselines[key]
        breach_counts = self._breach_counts[key]
        anomaly_scores = {}
        breaching_now = {}

        for band in BANDS:
            energy = energies[band]
            if baselines[band] is None:
                baselines[band] = energy
                score = 0.0
            else:
                score = (energy - baselines[band]) / (baselines[band] + 1e-6)
                baselines[band] = EWMA_ALPHA * energy + (1 - EWMA_ALPHA) * baselines[band]

            anomaly_scores[band] = score
            breaching_now[band] = score > ANOMALY_THRESHOLD

        verdict_bands = []
        for band in BANDS:
            if breaching_now[band]:
                breach_counts[band] += 1
            else:
                breach_counts[band] = 0

            if breach_counts[band] >= CONSECUTIVE_BREACHES_REQUIRED:
                verdict_bands.append(band)

        if not verdict_bands:
            return []

        top_bands = sorted(
            ({'band': b, 'energy': energies[b], 'anomaly_score': anomaly_scores[b]} for b in BANDS),
            key=lambda entry: entry['energy'],
            reverse=True,
        )[:3]

        # a concurrent acoustic-emission spike is a second, independent sensing
        # modality for the same physical fault, so it raises confidence rather
        # than just being logged alongside.
        acoustic_db = self._latest_acoustic_emission.get(asset_id)
        corroborated = acoustic_db is not None and acoustic_db >= ACOUSTIC_CORROBORATION_THRESHOLD_DB

        return [{
            'type': 'vibe_fault',
            'asset_id': asset_id,
            'metric': metric,
            'fault_bands': top_bands,
            'timestamp': reading['timestamp'],
            'severity': 'high' if corroborated else 'medium',
            'acoustic_corroborated': corroborated,
        }]

    def _on_acoustic_emission(self, reading: dict) -> list:
        asset_id = reading['assetId']
        db_level = reading['value']
        self._latest_acoustic_emission[asset_id] = db_level

        # below the advisory line this is just ambient noise, not worth an event
        # on its own; it still gets cached above for the next vibe_fault check.
        if db_level < ACOUSTIC_ADVISORY_THRESHOLD_DB:
            return []

        return [{
            'type': 'acoustic_advisory',
            'asset_id': asset_id,
            'db_level': db_level,
            'timestamp': reading['timestamp'],
        }]
