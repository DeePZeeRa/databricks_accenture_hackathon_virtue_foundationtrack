"""Chat history persistence with Redis + in-memory fallback."""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

import structlog

from app.core.config import settings
from app.services.cache_service import CacheService

logger = structlog.get_logger(__name__)

_HISTORY_PREFIX = "agent_history"
_in_memory_store: dict[str, dict[str, Any]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def build_history_entry(
    query: str,
    answer: str,
    query_type: str,
    processing_time_s: float,
    citations_count: int,
) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex,
        "query": query,
        "answer": answer,
        "query_type": query_type or "sql",
        "processing_time_s": float(processing_time_s or 0),
        "citations_count": int(citations_count or 0),
        "created_at": _now_ms(),
    }


def _get_from_memory(session_id: str) -> list[dict[str, Any]]:
    record = _in_memory_store.get(session_id)
    if not record:
        return []
    if record["expires_at"] <= time.time():
        _in_memory_store.pop(session_id, None)
        return []
    return list(record["items"])


def _set_in_memory(session_id: str, items: list[dict[str, Any]], ttl_seconds: int) -> None:
    _in_memory_store[session_id] = {
        "expires_at": time.time() + ttl_seconds,
        "items": list(items),
    }


def _build_key(session_id: str) -> str:
    return CacheService.build_key(_HISTORY_PREFIX, session_id)


async def get_history(session_id: str, limit: int = 20) -> list[dict[str, Any]]:
    key = _build_key(session_id)
    history = await CacheService.get(key)
    if history is None:
        history = _get_from_memory(session_id)
    if not history:
        return []
    return list(history)[: max(1, limit)]


async def add_entry(session_id: str, entry: dict[str, Any]) -> None:
    key = _build_key(session_id)
    history = await CacheService.get(key)
    if history is None:
        history = _get_from_memory(session_id)
    if not isinstance(history, list):
        history = []

    history.insert(0, entry)
    history = history[: settings.chat_history_max_entries]

    await CacheService.set(key, history, ttl=settings.chat_history_ttl_seconds)
    _set_in_memory(session_id, history, settings.chat_history_ttl_seconds)


def add_entry_sync(session_id: str, entry: dict[str, Any]) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        loop.create_task(add_entry(session_id, entry))
    else:
        asyncio.run(add_entry(session_id, entry))


async def clear_history(session_id: str) -> None:
    key = _build_key(session_id)
    await CacheService.set(key, [], ttl=settings.chat_history_ttl_seconds)
    _set_in_memory(session_id, [], settings.chat_history_ttl_seconds)
