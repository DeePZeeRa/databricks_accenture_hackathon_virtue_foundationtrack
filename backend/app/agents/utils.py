"""Agent utility helpers."""
from __future__ import annotations

import re
import time
from typing import Any, Optional


def call_llm_sync(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 1024,
    temperature: float = 0.0,
) -> str:
    """Synchronous LLM call — safe to run inside thread executor."""
    from app.core.config import settings
    import httpx

    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    headers = {
        "Authorization": f"Bearer {settings.databricks_token}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(settings.effective_llm_endpoint, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        # Handle both chat completions and direct response formats
        if "choices" in data:
            return data["choices"][0]["message"]["content"].strip()
        if "predictions" in data:
            return str(data["predictions"][0]).strip()
        if "outputs" in data:
            return str(data["outputs"][0]).strip()
        return str(data).strip()
    except Exception as e:
        return f"[LLM error: {e}]"


def build_citations_from_rag(rag_results: list[dict]) -> list[dict]:
    """Build citation objects from RAG search results."""
    citations = []
    for i, r in enumerate(rag_results):
        meta = r.get("metadata", {})
        citations.append({
            "id": i + 1,
            "facility_name": meta.get("name", r.get("facility_name", "Unknown")),
            "region": meta.get("region_normalised", r.get("region", "")),
            "city": meta.get("city_clean", ""),
            "facility_type": meta.get("facility_type_clean", ""),
            "similarity_score": round(float(r.get("score", 0)), 4),
            "source": "semantic_search",
            "snippet": (r.get("document", "") or "")[:300],
            "desert_label": meta.get("desert_label", ""),
            "unique_id": meta.get("unique_id", r.get("unique_id", "")),
            "idp_citations": r.get("citations", [])[:3],
        })
    return citations


def build_citations_from_sql(sql_results: list[dict], query_type: str) -> list[dict]:
    """Build citation objects from SQL results."""
    citations = []
    for i, row in enumerate(sql_results[:5]):
        citations.append({
            "id": i + 1,
            "facility_name": row.get("name", row.get("region_normalised", f"Record {i+1}")),
            "region": row.get("region_normalised", row.get("region", "")),
            "city": row.get("city_clean", ""),
            "facility_type": row.get("facility_type_clean", ""),
            "similarity_score": 1.0,
            "source": f"sql_{query_type}",
            "snippet": _row_to_snippet(row),
            "desert_label": row.get("desert_label", row.get("mds_label", "")),
            "unique_id": row.get("unique_id", ""),
            "idp_citations": [],
        })
    return citations


def _row_to_snippet(row: dict) -> str:
    """Convert a data row to a human-readable snippet."""
    parts = []
    if row.get("name"):
        parts.append(f"Facility: {row['name']}")
    if row.get("region_normalised") or row.get("region"):
        parts.append(f"Region: {row.get('region_normalised') or row.get('region')}")
    if row.get("facility_type_clean"):
        parts.append(f"Type: {row['facility_type_clean']}")
    if row.get("medical_desert_score") is not None:
        parts.append(f"MDS: {float(row['medical_desert_score']):.3f}")
    if row.get("total_facilities") is not None:
        parts.append(f"Facilities: {row['total_facilities']}")
    return " | ".join(parts) if parts else str(list(row.values())[:3])


def build_step_citations(
    node_name: str,
    step_num: int,
    input_summary: str,
    output_summary: str,
    data_sources: list[str],
    confidence: float = 0.9,
) -> dict:
    """Build a step-level citation for agentic trace transparency."""
    return {
        "step_id": f"step_{step_num:02d}",
        "step_name": node_name,
        "step_number": step_num,
        "confidence": confidence,
        "input_data": input_summary,
        "output_data": output_summary,
        "data_sources": data_sources,
        "timestamp": time.time(),
    }


def truncate(text: str, max_len: int = 200) -> str:
    if not text:
        return ""
    text = str(text)
    return text[:max_len] + "..." if len(text) > max_len else text


def safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def detect_regions_in_query(query: str) -> list[str]:
    """Detect Ghana region names mentioned in a query."""
    REGIONS = [
        "Greater Accra", "Ashanti", "Western North", "Western", "Eastern",
        "Central", "Volta", "Northern", "Upper East", "Upper West",
        "Brong-Ahafo", "Oti", "Bono East", "Bono", "Ahafo", "Savannah", "North East",
    ]
    found = []
    query_lower = query.lower()
    for region in REGIONS:
        if region.lower() in query_lower:
            found.append(region)
    return found
