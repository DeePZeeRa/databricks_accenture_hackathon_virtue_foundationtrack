"""Anomaly API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.services.sql_service import SQLQueryService

router = APIRouter()


@router.get("/anomalies")
async def get_anomalies(
    risk_level: str = "",
    region: str = "",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    ds = {}
    result = await SQLQueryService.get_anomalies(
        risk_level=risk_level, region=region,
        limit=limit, offset=offset, data_source_header=ds,
    )
    return JSONResponse(content=result, headers={"X-Data-Source": ds.get("source", "databricks")})


@router.get("/anomalies/summary")
async def get_anomaly_summary():
    ds = {}
    data = await SQLQueryService.get_anomaly_summary(data_source_header=ds)
    return JSONResponse(content=data, headers={"X-Data-Source": ds.get("source", "databricks")})
