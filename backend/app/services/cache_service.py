"""Upstash Redis cache service with no-op fallback."""
# This module provides a robust, abstract caching layer for the application.
# It uses Upstash Redis for production caching but automatically falls back
# to a No-Operation (`_NoOpCache`) implementation if the Redis credentials
# or the `upstash-redis` library are not available. This ensures the core
# application logic remains functional even when the cache service is down
# or misconfigured.

from __future__ import annotations

import json
from typing import Any, Callable, Optional

# `orjson` is a fast JSON library used for serializing Python objects into
# bytes before storing them in Redis. It's faster than the standard `json` module.
import orjson
# `structlog` is a structured logging library, which is better for production
# environments as it logs data in a machine-readable format (like JSON).
import structlog

# Initialize a logger instance using structlog.
logger = structlog.get_logger(__name__)


class _NoOpCache:
    """
    A silent no-operation (No-Op) cache implementation.
    This class is used as a fallback when Redis connection details are
    missing or the `upstash-redis` library cannot be imported.
    It implements the same async interface as the real Redis client
    but performs no actual operations, preventing runtime errors.
    """

    # `async def get(self, key: str) -> Optional[Any]:`
    # Purpose: Simulates fetching a value from the cache.
    # Logic: Always returns `None`, simulating a cache miss.
    # Example: If the real Redis client fails, this method ensures the
    # calling code receives `None` instead of an exception.
    async def get(self, key: str) -> Optional[Any]:  # noqa: ARG002
        return None

    # `async def set(self, key: str, value: Any, ttl: int = 300) -> None:`
    # Purpose: Simulates setting a key-value pair in the cache.
    # Logic: Does nothing (`pass`). The `ttl` (Time To Live) parameter is
    # accepted but ignored, as no write operation occurs.
    async def set(self, key: str, value: Any, **kwargs) -> None:  # noqa: ARG002
        pass  # accept any kwargs (ttl=, ex=, etc.) and silently ignore

    # `async def ping(self) -> bool:`
    # Purpose: Simulates checking the connection health.
    # Logic: Always returns `True`, indicating a successful connection check.
    async def ping(self) -> bool:
        return True

    # `async def keys(self, pattern: str) -> list:`
    # Purpose: Simulates listing keys matching a pattern.
    # Logic: Always returns an empty list, as no keys are stored.
    async def keys(self, pattern: str) -> list:  # noqa: ARG002
        return []

    # `async def delete(self, *keys: str) -> None:`
    # Purpose: Simulates deleting one or more keys.
    # Logic: Does nothing (`pass`).
    async def delete(self, *keys: str) -> None:
        pass


class CacheService:
    """
    The main service class managing the connection and operations for the
    caching layer. It acts as a singleton pattern, ensuring only one
    Redis client connection is established throughout the application's lifecycle.
    """
    # Class variables to hold the client instance and the no-op state.
    _client: Any = None
    _noop: bool = False

    @classmethod
    def _get_client(cls) -> Any:
        """
        Internal method to get or establish the Redis client connection.

        Logic Flow:
        1. Check if `cls._client` is already initialized (Singleton check). If so, return it.
        2. If not initialized, check `app.core.config.settings` to see if Redis is enabled.
        3. If Redis is disabled (`not settings.has_redis`):
           - Set `cls._noop = True`.
           - Set `cls._client` to an instance of `_NoOpCache`.
           - Log an informational message indicating the fallback mode.
           - Return the `_NoOpCache` instance.
        4. If Redis is enabled:
           - Attempt to import the actual `Redis` client from `upstash_redis`.
           - If successful:
             - Initialize `cls._client` using the credentials from `settings`.
             - Log a success message.
             - Return the live Redis client.
           - If `ImportError` occurs (library missing):
             - Fall back to the No-Op mode (same as step 3).
             - Log a warning about the missing library.
             - Return the `_NoOpCache` instance.
        5. The returned client is the active, usable connection object.
        """
        if cls._client is not None:
            return cls._client
        from app.core.config import settings # Import settings only when needed

        if not settings.has_redis:
            cls._noop = True
            cls._client = _NoOpCache()
            logger.info("cache_noop_mode", reason="no_upstash_credentials")
            return cls._client

        try:
            # Attempt to import the actual Redis client library.
            from upstash_redis import Redis  # type: ignore

            # Initialize the real Redis client using credentials from the settings.
            cls._client = Redis(
                url=settings.upstash_redis_rest_url,
                token=settings.upstash_redis_rest_token,
            )
            logger.info("cache_upstash_connected")
        except ImportError:
            # If the library is missing, we gracefully fall back to No-Op mode.
            cls._noop = True
            cls._client = _NoOpCache()
            logger.warning("cache_noop_mode", reason="upstash_redis_not_installed")
        return cls._client

    @classmethod
    async def get(cls, key: str) -> Optional[Any]:
        """
        Retrieves a value from the cache using the given key.

        Logic:
        1. Calls `_get_client()` to ensure a valid client is available.
        2. Checks if the client supports async operations (`asyncio_safe`).
        3. Executes the GET command using `await client.get(key)` (async) or `client.get(key)` (sync).
        4. If the result is `None` (cache miss), it returns `None`.
        5. If the value is bytes or string (common Redis return types), it attempts
           to deserialize it using `json.loads()`.
        6. If deserialization fails or the value is already a Python object, it returns the value.
        7. If any exception occurs during the process, it logs a warning and returns `None`.
        """
        try:
            client = cls._get_client()
            # Use `asyncio_safe` to determine if we need `await` for the client call.
            value = await client.get(key) if asyncio_safe(client) else client.get(key)
            if value is None:
                return None
            # Attempt to deserialize the stored value from bytes/string back into a Python object.
            if isinstance(value, (bytes, str)):
                return json.loads(value)
            return value
        except Exception as e:
            # Catch any exception (e.g., network error, serialization error)
            logger.warning("cache_get_error", key=key, error=str(e))
            return None

    @classmethod
    async def set(cls, key: str, value: Any, ttl: int = 300) -> None:
        """
        Sets a key-value pair in the cache with an optional Time To Live (TTL).

        Logic:
        1. Calls `_get_client()` to get the active client.
        2. Serializes the input `value` into JSON bytes using `orjson.dumps()`.
        3. Checks if the client supports async operations.
        4. Executes the SET command: `await client.set(key, serialized, ex=ttl)` (async)
           or `client.set(key, serialized, ex=ttl)` (sync).
        5. If any exception occurs, it logs a warning and silently fails (does not raise).
        """
        try:
            client = cls._get_client()
            serialized = orjson.dumps(value)
            if cls._noop:
                # _NoOpCache: just call and ignore, no TTL arg needed
                await client.set(key, serialized)
            elif asyncio_safe(client):
                # Real async Redis client (Upstash): uses ex= for TTL
                await client.set(key, serialized, ex=ttl)
            else:
                client.set(key, serialized, ex=ttl)
        except Exception as e:
            logger.warning("cache_set_error", key=key, error=str(e))

    @classmethod
    def build_key(cls, prefix: str, *args: Any) -> str:
        """
        Generates a consistent, unique cache key from a prefix and variable arguments.

        Logic:
        1. Initializes a list `parts` with the provided `prefix`.
        2. Iterates through all positional arguments (`*args`).
        3. If an argument is a dictionary, it converts the dictionary to a sorted
           string representation (e.g., `"{'a': 1, 'b': 2}"`) to ensure key
           consistency regardless of dictionary key order.
        4. Otherwise, it converts the argument directly to a string.
        5. Finally, it joins all collected parts with a colon (`:`) to form the
           final, unique cache key.
        Example: `build_key("user", 123, {"city": "Accra"})` → `"user:123:{'city': 'Accra'}"`
        """
        parts = [prefix]
        for a in args:
            if isinstance(a, dict):
                # Sorting items ensures that {'a': 1, 'b': 2} and {'b': 2, 'a': 1}
                # produce the same string representation.
                parts.append(str(sorted(a.items())))
            else:
                parts.append(str(a))
        return ":".join(parts)

    @classmethod
    async def health_check(cls) -> bool:
        """
        Checks the connectivity and operational status of the cache service.

        Logic:
        1. Gets the active client via `_get_client()`.
        2. If in No-Op mode, it immediately returns `True` (as it's always "available").
        3. If live, it executes the `ping()` command using the appropriate async/sync call.
        4. Catches any exception (e.g., network timeout, authentication failure)
           and logs a warning, returning `False` to signal failure.
        """
        try:
            client = cls._get_client()
            if cls._noop:
                return True
            # Use `asyncio_safe` to correctly await the ping call.
            result = await client.ping() if asyncio_safe(client) else client.ping()
            return bool(result)
        except Exception as e:
            # Log the failure and return False.
            logger.warning("cache_health_check_failed", error=str(e))
            return False

    @classmethod
    async def invalidate_prefix(cls, prefix: str) -> None:
        """
        Deletes all keys from the cache that start with a given prefix.

        Logic:
        1. Gets the active client.
        2. Constructs the Redis pattern: `f"{prefix}:*"`.
        3. Uses the client's `keys()` method to fetch all matching keys.
        4. If keys are found, it iterates through them and calls `delete()` for each one.
        5. Handles both async and sync client calls correctly.
        6. Catches exceptions during key fetching or deletion, logging a warning
           but allowing the application to continue.
        """
        try:
            client = cls._get_client()
            pattern = f"{prefix}:*"
            # Fetch all keys matching the pattern.
            keys = await client.keys(pattern) if asyncio_safe(client) else client.keys(pattern)
            if keys:
                # Loop through all found keys and delete them one by one.
                for k in keys:
                    if asyncio_safe(client):
                        await client.delete(k)
                    else:
                        client.delete(k)
        except Exception as e:
            # Log the error if key fetching or deletion fails.
            logger.warning("cache_invalidate_error", prefix=prefix, error=str(e))


def asyncio_safe(client: Any) -> bool:
    """
    Helper function to determine if the provided client object requires
    `await` when calling its methods.

    Logic:
    - It checks if the client is an instance of `_NoOpCache` (which is always
      safe to call asynchronously).
    - OR if the client object's class name contains "Redis", suggesting it's
      the async Upstash client.
    - This check prevents calling `await` on a synchronous client, which would
      cause a runtime error.
    """
    return isinstance(client, _NoOpCache) or hasattr(client, "__class__") and "Redis" in type(client).__name__


def cached(prefix: str, ttl: int = 300) -> Callable:
    """
    Decorator factory used to wrap an asynchronous function and automatically
    implement caching logic around it.

    This decorator is designed to be used on an `async` function (e.g.,
    `@cached("user_data")`).

    Args:
        prefix (str): The base prefix for the cache key (e.g., "user").
        ttl (int): The Time To Live for the cached item in seconds (default: 300s/5min).

    Returns:
        A decorator function that takes the target async function (`func`)
        and returns a new, wrapped asynchronous function (`wrapper`).
    """
    def decorator(func: Callable) -> Callable:
        # `functools.wraps(func)` preserves the original function's metadata
        # (like name, docstrings) on the wrapper function, which is crucial
        # for debugging and introspection.
        import functools

        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            # 1. Key Generation: Create a unique cache key using the service's
            #    standardized key builder, incorporating the function name and
            #    all arguments passed to the decorated function.
            key = CacheService.build_key(prefix, func.__name__, *args, **kwargs)

            # 2. Cache Read: Attempt to retrieve the result from the cache.
            cached_val = await CacheService.get(key)
            if cached_val is not None:
                # Cache Hit: If a value exists, return it immediately, skipping
                # the expensive function call.
                return cached_val

            # 3. Cache Miss: If no value is found, execute the original function.
            result = await func(*args, **kwargs)

            # 4. Cache Write: Store the newly computed result in the cache.
            await CacheService.set(key, result, ttl=ttl)

            # 5. Return: Return the result to the caller.
            return result

        return wrapper
    return decorator
