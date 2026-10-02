"""Test setup: the package imports itself as ``sednar``, so its parent folder goes on sys.path, and
HOME points at a scratch folder so tests never read or write the real ~/.sednar (settings, projects)."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.dirname(REPO))
sys.path.insert(0, os.path.join(REPO, "host"))  # the host app package (app.runtime), as server.py sets it up

_HOME = tempfile.mkdtemp(prefix="sednar-test-home-")
os.environ["HOME"] = _HOME


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_HOME, ignore_errors=True)


@pytest.fixture(scope="session")
def app_client():
    """The real Sednar Flask app (every route registered), driven through Flask's test client."""
    import importlib
    server = importlib.import_module("sednar.server")
    return server.app.test_client()
