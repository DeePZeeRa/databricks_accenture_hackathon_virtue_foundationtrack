"""Facility API endpoints."""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse

from app.services.sql_service import SQLQueryService
from app.services.faiss_service import FAISSIndexManager

router = APIRouter()


def _data_source_response(data: dict | list, source: str) -> JSONResponse:
    return JSONResponse(content=data, headers={"X-Data-Source": source})


@router.get("/facilities")
async def get_facilities(
    region: str = "",
    facility_type: str = "",
    search: str = "",
    volunteer: bool = False,
    has_emergency: Optional[bool] = None,
    has_surgery: Optional[bool] = None,
    has_icu: Optional[bool] = None,
    has_obstetrics: Optional[bool] = None,
    has_pediatrics: Optional[bool] = None,
    has_radiology: Optional[bool] = None,
    has_infectious_disease: Optional[bool] = None,
    has_mental_health: Optional[bool] = None,
    desert_label: str = "",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    ds = {}
    result = await SQLQueryService.get_facilities(
        region=region, facility_type=facility_type, search=search,
        volunteer=volunteer, has_emergency=has_emergency, has_surgery=has_surgery,
        has_icu=has_icu, has_obstetrics=has_obstetrics, has_pediatrics=has_pediatrics,
        has_radiology=has_radiology, has_infectious_disease=has_infectious_disease,
        has_mental_health=has_mental_health, desert_label=desert_label,
        limit=limit, offset=offset, data_source_header=ds,
    )
    return JSONResponse(content=result, headers={"X-Data-Source": ds.get("source", "databricks")})


@router.get("/facilities/statistics")
async def get_statistics():
    ds = {}
    stats = await SQLQueryService.get_stats(data_source_header=ds)
    return JSONResponse(content=stats, headers={"X-Data-Source": ds.get("source", "databricks")})


@router.get("/facilities/map")
async def get_map(
    region: str = "",
    facility_type: str = "",
    desert_only: bool = False,
):
    ds = {}
    geojson = await SQLQueryService.get_facilities_map(
        region=region, facility_type=facility_type, desert_only=desert_only, data_source_header=ds
    )
    return JSONResponse(content=geojson, headers={"X-Data-Source": ds.get("source", "databricks")})


@router.get("/facilities/search")
async def semantic_search(
    q: str = Query(..., min_length=3),
    region: str = "",
    facility_type: str = "",
    k: int = Query(8, ge=1, le=20),
):
    results = FAISSIndexManager.search(
        query=q, k=k,
        filter_region=region or None,
        filter_type=facility_type or None,
    )
    return {"results": results, "count": len(results)}


@router.get("/facilities/{unique_id}")
async def get_facility(unique_id: str):
    facility = await SQLQueryService.get_facility_detail(unique_id)
    if not facility:
        raise HTTPException(status_code=404, detail=f"Facility {unique_id} not found")
    return JSONResponse(content=facility, headers={"X-Data-Source": "databricks"})


# ── Legacy alias routes (keep existing frontend working) ──────────────────────
@router.get("/map/geojson")
async def get_map_legacy(region: str = "", facility_type: str = ""):
    return await get_map(region=region, facility_type=facility_type)
