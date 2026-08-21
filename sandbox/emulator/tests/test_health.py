from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def test_health_endpoint():
    app = create_app()
    # Before lifespan runs, backend_ready is False → 503
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/health")
    assert resp.status_code == 200 or resp.status_code == 503
    data = resp.json()
    assert "status" in data
