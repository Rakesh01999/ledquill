from app.core.settings import Settings, get_settings


def test_health_ok_when_db_and_redis_up(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {
        "status": "ok",
        "checks": {"database": "ok", "redis": "ok"},
        "schema": "ok",
    }


def test_health_503_when_redis_down(app, client):
    app.dependency_overrides[get_settings] = lambda: Settings(redis_url="redis://127.0.0.1:1/0")
    r = client.get("/api/v1/health")
    assert r.status_code == 503
    assert r.json()["checks"] == {"database": "ok", "redis": "down"}


def test_unknown_route_returns_problem_json(client):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.json()["status"] == 404


def test_outdated_schema_is_reported_but_never_fails_health(client, monkeypatch):
    monkeypatch.setattr("app.api.health._expected_revision", lambda: "9999")
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["schema"] == "outdated"


def test_schema_unknown_when_it_cannot_be_read(client, monkeypatch):
    def broken():
        raise OSError("no alembic.ini")

    monkeypatch.setattr("app.api.health._expected_revision", broken)
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["schema"] == "unknown"
