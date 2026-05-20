"""Health check endpoint."""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()
_start_time = time.monotonic()


@router.get("/health")
async def health_check() -> JSONResponse:
    from app.core.database import DatabricksQueryExecutor
    from app.services.cache_service import CacheService
    from app.services.faiss_service import FAISSIndexManager

    async def _db_check():
        try:
            return await asyncio.wait_for(DatabricksQueryExecutor.health_check(), timeout=5.0)
        except Exception:
            return False

    async def _cache_check():
        try:
            return await asyncio.wait_for(CacheService.health_check(), timeout=2.0)
        except Exception:
            return False

    db_ok, cache_ok = await asyncio.gather(_db_check(), _cache_check())
    faiss_ok = FAISSIndexManager._loaded

    all_ok = db_ok  # FAISS is optional RAG — only Databricks is core
    status = "healthy" if all_ok else "degraded"

    return JSONResponse(
        content={
            "status": status,
            "databricks_connected": db_ok,
            "redis_connected": cache_ok,
            "faiss_loaded": faiss_ok,
            "faiss_strategy": FAISSIndexManager._load_strategy,
            "uptime_seconds": round(time.monotonic() - _start_time, 1),
            "version": "1.0.0",
        },
        headers={"Cache-Control": "no-cache"},
    )
