import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Real fog and backend code, imported directly, not re-implemented for this test.
for module_dir in ("fog", "backend"):
    path = str(ROOT / module_dir)
    if path not in sys.path:
        sys.path.insert(0, path)

os.environ.setdefault("AEROSENSE_ADVISORY_TABLE", "AeroSenseAdvisoryEvents")
