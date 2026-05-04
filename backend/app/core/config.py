"""Core configuration using pydantic-settings."""
from __future__ import annotations

import functools
from typing import Optional

from pydantic import field_validator, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Databricks ─────────────────────────────────────────────────────────────
    databricks_host: str = "https://dbc-147ceb0b-b41d.cloud.databricks.com"
    databricks_token: str = ""
    databricks_http_path: str = ""
    databricks_sql_warehouse_id: str = ""
    databricks_catalog: str = "virtue_foundation"
    databricks_schema: str = "ghana"

    # ── LLM & Embedding ────────────────────────────────────────────────────────
    llm_endpoint: str = ""
    embed_endpoint: str = ""
    llm_model: str = "databricks-meta-llama-3-3-70b-instruct"

    # ── Upstash Redis ──────────────────────────────────────────────────────────
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""

    # ── FAISS ──────────────────────────────────────────────────────────────────
    faiss_index_path: str = "./rag_data/faiss_index.bin"
    faiss_meta_path: str = "./rag_data/faiss_metadata.json"
    faiss_index_url: str = ""
    faiss_meta_url: str = ""

    # ── Security ───────────────────────────────────────────────────────────────
    secret_key: str = "changeme_at_least_32_characters_long_for_production_use"
    api_keys: str = ""

    # ── CORS ───────────────────────────────────────────────────────────────────
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # ── Rate limiting & timeouts ───────────────────────────────────────────────
    rate_limit_per_minute: int = 20
    agent_timeout_seconds: int = 180

    # ── Chat history ───────────────────────────────────────────────────────────
    chat_history_ttl_seconds: int = 86400
    chat_history_max_entries: int = 50
    chat_history_context_limit: int = 4

    # ── Logging ────────────────────────────────────────────────────────────────
    log_level: str = "INFO"

    # ── Environment ────────────────────────────────────────────────────────────
    environment: str = "development"

    # ── MLflow ─────────────────────────────────────────────────────────────────
    mlflow_tracking_uri: str = "databricks"

    # ── Validators ─────────────────────────────────────────────────────────────

    @field_validator("databricks_host")
    @classmethod
    def clean_databricks_host(cls, v: str) -> str:
        v = v.rstrip("/")
        if not v.startswith("https://") and not v.startswith("http://"):
            v = f"https://{v}"
        return v

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long")
        return v

    # ── Computed fields ────────────────────────────────────────────────────────

    @computed_field  # type: ignore[misc]
    @property
    def effective_http_path(self) -> str:
        """Derive HTTP path from warehouse ID if not explicitly set."""
        if self.databricks_http_path:
            return self.databricks_http_path
        if self.databricks_sql_warehouse_id:
            return f"/sql/1.0/warehouses/{self.databricks_sql_warehouse_id}"
        return ""

    @computed_field  # type: ignore[misc]
    @property
    def databricks_server_hostname(self) -> str:
        """Extract hostname without https:// prefix."""
        return self.databricks_host.replace("https://", "").replace("http://", "")

    @computed_field  # type: ignore[misc]
    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @computed_field  # type: ignore[misc]
    @property
    def api_keys_list(self) -> set[str]:
        return {k.strip() for k in self.api_keys.split(",") if k.strip()}

    @computed_field  # type: ignore[misc]
    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @computed_field  # type: ignore[misc]
    @property
    def has_redis(self) -> bool:
        return bool(self.upstash_redis_rest_url and self.upstash_redis_rest_token)

    @computed_field  # type: ignore[misc]
    @property
    def has_embed_endpoint(self) -> bool:
        return bool(self.embed_endpoint)

    @computed_field  # type: ignore[misc]
    @property
    def has_llm_endpoint(self) -> bool:
        return bool(self.llm_endpoint or self.databricks_token)

    @computed_field  # type: ignore[misc]
    @property
    def effective_llm_endpoint(self) -> str:
        if self.llm_endpoint:
            return self.llm_endpoint
        return f"{self.databricks_host}/serving-endpoints/{self.llm_model}/invocations"

    @computed_field  # type: ignore[misc]
    @property
    def databricks_catalog_schema(self) -> str:
        return f"`{self.databricks_catalog}`.`{self.databricks_schema}`"


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
