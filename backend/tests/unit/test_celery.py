from app.workers.tasks import ping


def test_ping_task_returns_pong():
    assert ping.apply().get() == "pong"
