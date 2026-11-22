"""FastAPI app factory."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import documents, health
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.settings import get_settings


def _use_binary_format_for_files(app: FastAPI) -> None:
    """FastAPI 3.1 schemas mark uploads with `contentMediaType`, which Swagger UI shows as a
    string editor. Rewrite them to `format: binary` so /docs renders file pickers."""
    build = app.openapi

    def openapi() -> dict:
        if app.openapi_schema is None:
            schema = build()
            for name, body in schema.get("components", {}).get("schemas", {}).items():
                if not name.startswith("Body_"):
                    continue
                for prop in body.get("properties", {}).values():
                    for node in (prop, prop.get("items", {})):
                        if node.get("contentMediaType") == "application/octet-stream":
                            del node["contentMediaType"]
                            node["format"] = "binary"
        return app.openapi_schema

    app.openapi = openapi


def create_app() -> FastAPI:
    configure_logging()
    settings = get_settings()
    app = FastAPI(title="LedQuill API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(health.router, prefix="/api/v1")
    app.include_router(documents.router, prefix="/api/v1")
    _use_binary_format_for_files(app)
    return app
