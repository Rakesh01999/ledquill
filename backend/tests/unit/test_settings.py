import pytest
from pydantic import ValidationError

from app.core.settings import Settings


def test_defaults_match_design_spec():
    s = Settings(_env_file=None)
    assert s.ledquill_max_upload_mb == 25
    assert s.ledquill_max_files_per_request == 20
    assert s.llm_model_chain[0] == "groq:openai/gpt-oss-120b"
    assert s.llm_model_chain[-1] == "gemini:gemini-3.8-flash"
    assert len(s.llm_model_chain) == 4


def test_reads_from_environment(monkeypatch):
    monkeypatch.setenv("LEDQUILL_MAX_UPLOAD_MB", "5")
    monkeypatch.setenv("LEDQUILL_CORS_ORIGINS", "http://a.test, http://b.test")
    s = Settings()
    assert s.ledquill_max_upload_mb == 5
    assert s.cors_origins == ["http://a.test", "http://b.test"]


def test_rejects_invalid_values(monkeypatch):
    monkeypatch.setenv("LEDQUILL_ENV", "production")
    with pytest.raises(ValidationError):
        Settings()
