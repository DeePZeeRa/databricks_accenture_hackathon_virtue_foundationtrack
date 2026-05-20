"""Regions API endpoints."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services.sql_service import SQLQueryService

router = APIRouter()


@router.get("/regions")
async def get_regions():
    regions = await SQLQueryService.get_regions()
    return {"regions": regions}


@router.get("/regions/summary")
async def get_regional_summary():
    ds = {}
    data = await SQLQueryService.get_regional_summary(data_source_header=ds)
    return JSONResponse(content=data, headers={"X-Data-Source": ds.get("source", "databricks")})


@router.get("/regions/desert")
async def get_desert_regions():
    data = await SQLQueryService.get_desert_regions()
    return data


@router.get("/regions/specialty-gaps")
async def get_specialty_gaps():
    data = await SQLQueryService.get_specialty_gaps()
    return data


@router.get("/regions/priority")
async def get_regional_priority():
    """Return priority-ranked regions from gold_regional_priority table."""
    ds = {}
    data = await SQLQueryService.get_regional_priority(data_source_header=ds)
    return JSONResponse(content=data, headers={"X-Data-Source": ds.get("source", "databricks")})



@router.get("/desert/scores")
async def get_desert_scores():
    ds = {}
    data = await SQLQueryService.get_desert_scores(data_source_header=ds)
    return JSONResponse(content=data, headers={"X-Data-Source": ds.get("source", "databricks")})
