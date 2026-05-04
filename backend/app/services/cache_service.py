"""Upstash Redis cache service with no-op fallback."""
from __future__ import annotations

import json
from typing import Any, Callable, Optional

import orjson
import structlog

logger = structlog.get_logger(__name__)


class _NoOpCache:
    """Silent no-op cache when Redis is not configured."""

    async def get(self, key: str) -> Optional[Any]:  # noqa: ARG002
        return None

    async def set(self, key: str, value: Any, ttl: int = 300) -> None:  # noqa: ARG002
        pass

    async def ping(self) -> bool:
        return True

    async def keys(self, pattern: str) -> list:  # noqa: ARG002
        return []

    async def delete(self, *keys: str) -> None:
        pass


class CacheService:
    _client: Any = None
    _noop: bool = False

    @classmethod
    def _get_client(cls) -> Any:
        if cls._client is not None:
            return cls._client
        from app.core.config import settings

        if not settings.has_redis:
            cls._noop = True
            cls._client = _NoOpCache()
            logger.info("cache_noop_mode", reason="no_upstash_credentials")
            return cls._client

        try:
            from upstash_redis import Redis  # type: ignore

            cls._client = Redis(
                url=settings.upstash_redis_rest_url,
                token=settings.upstash_redis_rest_token,
            )
            logger.info("cache_upstash_connected")
        except ImportError:
            cls._noop = True
            cls._client = _NoOpCache()
            logger.warning("cache_noop_mode", reason="upstash_redis_not_installed")
        return cls._client

    @classmethod
    async def get(cls, key: str) -> Optional[Any]:
        try:
            client = cls._get_client()
            value = await client.get(key) if asyncio_safe(client) else client.get(key)
            if value is None:
                return None
            if isinstance(value, (bytes, str)):
                return json.loads(value)
            return value
        except Exception as e:
            logger.warning("cache_get_error", key=key, error=str(e))
            return None

    @classmethod
    async def set(cls, key: str, value: Any, ttl: int = 300) -> None:
        try:
            client = cls._get_client()
            serialized = orjson.dumps(value)
            if asyncio_safe(client):
                await client.set(key, serialized, ex=ttl)
            else:
                client.set(key, serialized, ex=ttl)
        except Exception as e:
            logger.warning("cache_set_error", key=key, error=str(e))

    @classmethod
    def build_key(cls, prefix: str, *args: Any) -> str:
        parts = [prefix]
        for a in args:
            if isinstance(a, dict):
                parts.append(str(sorted(a.items())))
            else:
                parts.append(str(a))
        return ":".join(parts)

    @classmethod
    async def health_check(cls) -> bool:
        try:
            client = cls._get_client()
            if cls._noop:
                return True
            result = await client.ping() if asyncio_safe(client) else client.ping()
            return bool(result)
        except Exception as e:
            logger.warning("cache_health_check_failed", error=str(e))
            return False

    @classmethod
    async def invalidate_prefix(cls, prefix: str) -> None:
        try:
            client = cls._get_client()
            pattern = f"{prefix}:*"
            keys = await client.keys(pattern) if asyncio_safe(client) else client.keys(pattern)
            if keys:
                for k in keys:
                    if asyncio_safe(client):
                        await client.delete(k)
                    else:
                        client.delete(k)
        except Exception as e:
            logger.warning("cache_invalidate_error", prefix=prefix, error=str(e))


def asyncio_safe(client: Any) -> bool:
    """Check if client supports async (Upstash) vs sync (no-op)."""
    return isinstance(client, _NoOpCache) or hasattr(client, "__class__") and "Redis" in type(client).__name__


def cached(prefix: str, ttl: int = 300) -> Callable:
    """Decorator factory for caching async function results."""
    def decorator(func: Callable) -> Callable:
        import functools

        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            key = CacheService.build_key(prefix, func.__name__, *args, **kwargs)
            cached_val = await CacheService.get(key)
            if cached_val is not None:
                return cached_val
            result = await func(*args, **kwargs)
            await CacheService.set(key, result, ttl=ttl)
            return result

        return wrapper
    return decorator
