"""FastAPI application factory with full lifespan management."""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

logger = structlog.get_logger(__name__)
_startup_time = time.monotonic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    from app.core.config import settings
    import structlog

    # Configure structlog
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer() if not settings.is_production else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}.get(settings.log_level.upper(), 20)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )

    startup_start = time.monotonic()
    logger.info("startup_begin", environment=settings.environment)

    # Step 1: Databricks
    try:
        from app.core.database import DatabricksQueryExecutor
        db_ok = await DatabricksQueryExecutor.health_check()
        logger.info("startup_databricks", connected=db_ok, host=settings.databricks_server_hostname)
    except Exception as e:
        logger.warning("startup_databricks_failed", error=str(e))

    # Step 2: FAISS
    try:
        from app.services.faiss_service import FAISSIndexManager
        FAISSIndexManager.initialize()
        logger.info(
            "startup_faiss",
            loaded=FAISSIndexManager._loaded,
            strategy=FAISSIndexManager._load_strategy,
            vectors=FAISSIndexManager._index.ntotal if FAISSIndexManager._index else 0,
        )
    except Exception as e:
        logger.warning("startup_faiss_failed", error=str(e))

    # Step 3: Redis
    try:
        from app.services.cache_service import CacheService
        cache_ok = await CacheService.health_check()
        logger.info("startup_cache", connected=cache_ok, has_redis=settings.has_redis)
    except Exception as e:
        logger.warning("startup_cache_failed", error=str(e))

    # Step 4: Agent graph (lazy compiled at module import)
    try:
        from app.agents.graph import VIRTUE_AGENT
        logger.info("startup_agent", ready=VIRTUE_AGENT is not None)
    except Exception as e:
        logger.warning("startup_agent_failed", error=str(e))

    total_startup = round(time.monotonic() - startup_start, 2)
    logger.info("startup_complete", elapsed_s=total_startup)

    yield  # App is running

    # Shutdown
    try:
        from app.core.database import DatabricksQueryExecutor
        DatabricksQueryExecutor.close()
    except Exception:
        pass
    logger.info("shutdown_complete")


def create_app() -> FastAPI:
    from app.core.config import settings

    app = FastAPI(
        title="Virtue Foundation Ghana Healthcare Intelligence API",
        description="AI-powered healthcare intelligence platform for Ghana NGO programme officers",
        version="1.0.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # Middleware stack (order matters)
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Data-Source", "X-Response-Time", "X-Request-ID"],
    )

    # Request ID + Timing middleware
    @app.middleware("http")
    async def request_middleware(request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        start = time.monotonic()
        response = await call_next(request)
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time"] = f"{elapsed_ms}ms"
        return response

    # Exception handlers
    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError):
        return JSONResponse(status_code=400, content={"error": str(exc)})

    @app.exception_handler(Exception)
    async def general_error_handler(request: Request, exc: Exception):
        logger.error(
            "unhandled_exception",
            path=request.url.path,
            error=str(exc),
            request_id=getattr(request.state, "request_id", ""),
        )
        return JSONResponse(status_code=500, content={"error": "Internal server error"})

    # Register routers
    from app.api.health import router as health_router
    from app.api.facilities import router as facilities_router
    from app.api.regions import router as regions_router
    from app.api.anomalies import router as anomalies_router
    from app.api.agent import router as agent_router
    from app.api.exports import router as exports_router

    app.include_router(health_router)
    app.include_router(facilities_router, prefix="/api/v1")
    app.include_router(regions_router, prefix="/api/v1")
    app.include_router(anomalies_router, prefix="/api/v1")
    app.include_router(agent_router, prefix="/api/v1")
    app.include_router(exports_router, prefix="/api/v1")

    # Legacy aliases (no prefix — matches existing frontend /api/ calls)
    app.include_router(facilities_router, prefix="/api")
    app.include_router(regions_router, prefix="/api")
    app.include_router(anomalies_router, prefix="/api")
    app.include_router(agent_router, prefix="/api")

    @app.get("/")
    async def root():
        return {
            "name": "Virtue Foundation Ghana Healthcare Intelligence API",
            "version": "1.0.0",
            "status": "running",
            "docs": "/docs",
        }
    return app


app = create_app()
#  python3.14 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# http://localhost:8000/docs

# .venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000 --reload