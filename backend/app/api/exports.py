"""CSV export endpoints."""
from __future__ import annotations

import csv
import io
import time
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.sql_service import SQLQueryService

router = APIRouter()


async def _csv_generator(rows: list[dict], filename_base: str) -> AsyncGenerator[str, None]:
    """Generate CSV rows as string chunks."""
    if not rows:
        yield "No data available\n"
        return

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    yield output.getvalue()
    output.truncate(0)
    output.seek(0)

    for row in rows:
        # Convert any non-serializable values
        clean_row = {k: str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v for k, v in row.items()}
        writer.writerow(clean_row)
        yield output.getvalue()
        output.truncate(0)
        output.seek(0)


def _ts() -> str:
    return time.strftime("%Y%m%d_%H%M%S")


@router.get("/export/facilities")
async def export_facilities(region: str = "", facility_type: str = ""):
    result = await SQLQueryService.get_facilities(region=region, facility_type=facility_type, limit=1000)
    rows = result.get("items", [])
    filename = f"ghana_facilities_{_ts()}.csv"

    return StreamingResponse(
        _csv_generator(rows, filename),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/export/desert-scores")
async def export_desert_scores():
    rows = await SQLQueryService.get_desert_scores()
    filename = f"ghana_desert_scores_{_ts()}.csv"
    return StreamingResponse(
        _csv_generator(rows, filename),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/export/anomalies")
async def export_anomalies(risk_level: str = ""):
    result = await SQLQueryService.get_anomalies(risk_level=risk_level, limit=500)
    rows = result.get("items", [])
    filename = f"ghana_anomalies_{_ts()}.csv"
    return StreamingResponse(
        _csv_generator(rows, filename),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
