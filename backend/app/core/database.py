"""Databricks SQL connection executor — async-safe wrapper around sync connector."""
from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

import structlog

logger = structlog.get_logger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="dbx-sql")


class DatabricksQueryExecutor:
    """Thread-safe, async-wrapped Databricks SQL executor."""

    _connection: Any = None
    _lock: threading.Lock = threading.Lock()

    @classmethod
    def _get_connection_sync(cls) -> Any:
        """Create or return existing connection (call from thread only)."""
        from app.core.config import settings

        if cls._connection is not None:
            try:
                cursor = cls._connection.cursor()
                cursor.execute("SELECT 1")
                cursor.close()
                return cls._connection
            except Exception:
                cls._connection = None

        try:
            import databricks.sql as dbsql  # type: ignore

            cls._connection = dbsql.connect(
                server_hostname=settings.databricks_server_hostname,
                http_path=settings.effective_http_path,
                access_token=settings.databricks_token,
                _tls_verify_hostname=True,
                _use_cloud_fetch=True,
                socket_timeout=120,
            )
            logger.info("databricks_connected", host=settings.databricks_server_hostname)
            return cls._connection
        except Exception as e:
            logger.error("databricks_connect_failed", error=str(e))
            raise

    @classmethod
    def _execute_sync(
        cls,
        sql: str,
        parameters: Optional[list] = None,
        max_rows: int = 1000,
    ) -> list[dict]:
        """Execute query synchronously — runs inside thread executor."""
        start = time.monotonic()
        conn = cls._get_connection_sync()
        rows: list[dict] = []

        try:
            cursor = conn.cursor()
            if parameters:
                cursor.execute(sql, parameters)
            else:
                cursor.execute(sql)

            if cursor.description:
                cols = [d[0] for d in cursor.description]
                raw = cursor.fetchmany(max_rows)
                rows = [dict(zip(cols, row)) for row in raw]

            cursor.close()
        except Exception as e:
            # Attempt reconnect once
            logger.warning("query_error_reconnecting", error=str(e))
            cls._connection = None
            conn = cls._get_connection_sync()
            cursor = conn.cursor()
            if parameters:
                cursor.execute(sql, parameters)
            else:
                cursor.execute(sql)
            if cursor.description:
                cols = [d[0] for d in cursor.description]
                raw = cursor.fetchmany(max_rows)
                rows = [dict(zip(cols, row)) for row in raw]
            cursor.close()

        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        logger.info(
            "query_executed",
            sql_preview=sql[:300].replace("\n", " "),
            rows=len(rows),
            elapsed_ms=elapsed_ms,
        )
        return rows

    @classmethod
    async def execute(
        cls,
        sql: str,
        parameters: Optional[list] = None,
        max_rows: int = 1000,
    ) -> list[dict]:
        """Async wrapper — runs blocking SQL in thread executor."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _executor,
            lambda: cls._execute_sync(sql, parameters, max_rows),
        )

    @classmethod
    def execute_sync(
        cls,
        sql: str,
        parameters: Optional[list] = None,
        max_rows: int = 1000,
    ) -> list[dict]:
        """Synchronous execute — for use inside agent node threads."""
        return cls._execute_sync(sql, parameters, max_rows)

    @classmethod
    async def health_check(cls) -> bool:
        try:
            result = await cls.execute("SELECT 1 AS health_check", max_rows=1)
            return len(result) > 0
        except Exception as e:
            logger.error("databricks_health_check_failed", error=str(e))
            return False

    @classmethod
    def close(cls) -> None:
        if cls._connection is not None:
            try:
                cls._connection.close()
            except Exception:
                pass
            cls._connection = None
            logger.info("databricks_connection_closed")
