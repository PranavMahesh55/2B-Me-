import os
import tempfile
from pathlib import Path


TEST_DIR = Path(tempfile.mkdtemp(prefix="2bme-backend-tests-"))
os.environ["BEHAVIOR_DATABASE_PATH"] = str(TEST_DIR / "behavior-test.db")
os.environ["BEHAVIOR_DATA_MODE"] = "synthetic"

