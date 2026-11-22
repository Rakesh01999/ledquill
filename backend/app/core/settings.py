"""Application settings, read once from environment variables (design.md section 5)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Env var names match field names case-insensitively (LEDQUILL_ENV -> ledquill_env).
    model_config = SettingsConfigDict(extra="ignore")

    # app
    ledquill_env: Literal["local", "demo", "test"] = "local"
    ledquill_api_key: str = ""
    ledquill_max_upload_mb: int = Field(25, gt=0)
    ledquill_max_files_per_request: int = Field(20, gt=0)
    ledquill_cors_origins: str = "http://localhost:3000"
    # decompression-bomb guards (PermanentError when exceeded)
    ledquill_max_pdf_pages: int = Field(2000, gt=0)
    ledquill_max_tiff_frames: int = Field(200, gt=0)
    ledquill_max_image_pixels: int = Field(50_000_000, gt=0)

    # data
    database_url: str = "postgresql+psycopg://ledquill:ledquill@db:5432/ledquill"
    redis_url: str = "redis://redis:6379/0"
    storage_backend: Literal["local", "supabase"] = "local"
    storage_local_dir: str = "/data/uploads"
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_bucket: str = "documents"

    # llm
    groq_api_key: str = ""
    gemini_api_key: str = ""
    llm_models: str = (
        "groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,"
        "groq:openai/gpt-oss-20b,gemini:gemini-3.8-flash"
    )
    embedding_model: str = "BAAI/bge-small-en-v1.5"

    @property
    def max_upload_bytes(self) -> int:
        return self.ledquill_max_upload_mb * 1024 * 1024

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.ledquill_cors_origins.split(",") if o.strip()]

    @property
    def llm_model_chain(self) -> list[str]:
        return [m.strip() for m in self.llm_models.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
