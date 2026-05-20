"""LangGraph node implementations — all nodes schema-aligned to actual Delta tables.
Covers all 59 MoSCoW questions from the VF Agent Comprehensive Question Reference.
"""
from __future__ import annotations

import asyncio
import json
import math
import re
import time
from typing import Any

import structlog

from app.agents.state import AgentState
from app.agents.prompts import (
    ROUTER_SYSTEM_PROMPT, SQL_SYSTEM_PROMPT,
    SYNTHESISER_SYSTEM_PROMPT, MEDICAL_SYSTEM_PROMPT,
    PLANNING_SYSTEM_PROMPT, WORKFORCE_SYSTEM_PROMPT,
    RESOURCE_SYSTEM_PROMPT, VALIDATION_SYSTEM_PROMPT,
)
from app.agents.utils import (
    call_llm_sync, build_citations_from_rag, build_citations_from_sql,
    build_step_citations, truncate, safe_float, detect_regions_in_query,
)

logger = structlog.get_logger(__name__)

CATALOG = "virtue_foundation.ghana"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _run_async(coro):
    """Run an async coroutine safely from a sync thread (LangGraph worker thread)."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = None

    if loop is not None and loop.is_running():
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result(timeout=60)
    else:
        return asyncio.run(coro)


def _faiss():
    from app.services.faiss_service import FAISSIndexManager
    return FAISSIndexManager


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute geodesic distance in km between two lat/lon points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _extract_radius_km(query: str, default: float = 50.0) -> float:
    """Extract radius in km from query text like '100km' or '30 km'."""
    m = re.search(r"(\d+)\s*km", query, re.IGNORECASE)
    return float(m.group(1)) if m else default


def _sql(sql: str, max_rows: int = 50) -> list[dict]:
    """Execute a raw SQL string and return rows."""
    from app.services.sql_service import SQLQueryService
    return _run_async(SQLQueryService.execute_agent_sql(sql, max_rows=max_rows))


# ─────────────────────────────────────────────────────────────────────────────
# ROUTER — maps all 59 MoSCoW question categories
# ─────────────────────────────────────────────────────────────────────────────
def router_node(state: AgentState) -> AgentState:
    query = state["query"]
    ql = query.lower()
    step_num = 1

    # ── Q4.x / Q3.1 — Anomaly & misrepresentation detection ──────────────────
    if any(w in ql for w in [
        "anomal", "ghost", "suspicious", "fake", "flag", "inconsist",
        "unrealistic", "claim", "lack equipment", "mismatch", "breadth",
        "inflat", "without equipment", "misrepresent",
        "bed-to-", "bed to ", "abnormal pattern", "shouldn't move",
        "should not move", "things that shouldn", "highly specialized",
        "large bed", "minimal equipment", "high breadth",
        "enhanced_procedures", "no_equipment",
    ]):
        query_type = "anomaly"
        sub_agents = ["sql", "anomaly", "medical"]

    # ── Q3.4, Q3.5 — Validation & verification ────────────────────────────────
    elif any(w in ql for w in [
        "corrobor", "co-occur", "cooccur", "what percent", "what % ",
        "verify", "verification", "permanent vs", "permanent versus",
        "traveling equip", "temporary equip", "validate", "cross-source",
        "multiple source", "independent source",
        "minimum required equip", "minimum equipment",
        "also list", "also have", "do they have",
    ]):
        query_type = "validation"
        sub_agents = ["sql", "rag", "validation"]

    # ── Q6.x — Workforce distribution ────────────────────────────────────────
    elif any(w in ql for w in [
        "visiting", "itinerant", "surgical camp", "outreach camp",
        "temporary staff", "permanent staff", "visiting surgeon",
        "visiting consultant", "named surgeon", "workforce",
        "where are doctor", "where are specialist",
        "visiting specialist", "medical mission", "locum",
        "tied to individual", "fragility", "continuity risk",
        "evidence of visiting", "evidence of specialist",
    ]):
        query_type = "workforce"
        sub_agents = ["sql", "rag", "workforce"]

    # ── Q2.3 / Q7.5 / Q8.3 — Desert, cold spots, gaps ───────────────────────
    elif any(w in ql for w in [
        "desert", "underserv", "cold spot", "missing special",
        "critical region", "no icu", "no surgery", "no emergency",
        "coverage gap", "absent within", "no facilities treating",
        "depends on only", "depend on 1 ", "depend on 2 ",
        "single point of failure",
        "only 1 or 2", "only 1 facilit", "only 2 facilit",
        "no organization", "no ngo working", "ngo gap",
        "gaps where no", "gap where no",
    ]):
        query_type = "desert"
        sub_agents = ["sql", "desert", "medical"]

    # ── Q7.x — Resource distribution, scarcity, oversupply ───────────────────
    elif any(w in ql for w in [
        "scarcit", "oversupply", "scarce", "insuffici",
        "procedure scarcit", "few facilities", "rare procedure",
        "high-complexity", "low-complexity", "legacy equipment",
        "older equipment", "concentrate", "problem type by region",
        "lack of equipment", "high practitioner",
    ]):
        query_type = "resource"
        sub_agents = ["sql", "desert", "medical"]

    # ── Q2.1 / Q2.3 — Geospatial proximity ───────────────────────────────────
    elif any(w in ql for w in [
        "nearest", "closest", "radius", "km away",
        "distance", "near ", "within ", "km of", "km from",
        "travel time", "hours away",
    ]):
        query_type = "geo"
        sub_agents = ["rag", "geo"]

    # ── Planning — action plans, deployment, prioritization ──────────────────
    elif any(w in ql for w in [
        "action plan", "deploy", "allocate", "priorit", "recommend",
        "intervention", "sweet spot", "high-impact", "programme officer",
        "what should we do", "where to focus", "where to intervene",
    ]):
        query_type = "planning"
        sub_agents = ["sql", "desert", "planning"]

    # ── Q8.x — NGO & international organization analysis ─────────────────────
    elif any(w in ql for w in [
        "ngo", "charity", "faith", "church", "chag",
        "mission organiz", "international org",
        "overlapping service", "ngo overlap",
        "aid organiz", "substitute for permanent",
    ]):
        query_type = "ngo"
        sub_agents = ["sql", "ngo", "medical"]

    # ── Q10.x — Benchmarking & comparative analysis ───────────────────────────
    elif any(w in ql for w in [
        "benchmark", "compare", "who guideline", "who standard",
        "global average", "developed countr", "ratio per", "per 100",
        "per 10,000", "per 10000", "population ratio",
        "sweet spot cluster", "high-impact site", "probability of",
    ]):
        query_type = "sql"
        sub_agents = ["sql", "web", "medical"]

    # ── Q5.x — Service classification & inference ────────────────────────────
    elif any(w in ql for w in [
        "service bundle", "service maturity", "itinerant outreach",
        "refer patient", "we can arrange", "we collaborate", "we send",
        "operational capabilit", "appointment workflow",
        "procedure co-occur", "procedure bundle", "glaucoma bundle",
        "cornea bundle", "service classif",
    ]):
        query_type = "validation"
        sub_agents = ["rag", "validation", "medical"]

    # ── Q1.3 / Q1.4 — Named facility or area+service lookups ─────────────────
    elif any(w in ql for w in [
        "what service", "what does", "capabilities of",
        "offer", "provides", "what can", "tell me about",
        "find facility", "find clinic", "find hospital",
        "similar facilit", "search for",
    ]):
        query_type = "rag"
        sub_agents = ["sql", "rag"]

    # ── Q1.x / Q4.7 / Q10.x — Basic counts, lists, lookups ──────────────────
    elif any(w in ql for w in [
        "how many", "count", "total", "list all",
        "how much", "percentage", "ratio", "rate",
        "which region", "which hospital", "hospitals in ",
        "clinics in ", "correlation",
    ]):
        query_type = "sql"
        sub_agents = ["sql"]

    # ── Web search — external data, global guidelines ─────────────────────────
    elif any(w in ql for w in [
        "who guideline", "global", "international",
        "research", "study", "news", "latest", "external",
        "worldwide", "united nations", "unicef", "world bank",
    ]):
        query_type = "web"
        sub_agents = ["web"]

    # ── Default — SQL fallback ────────────────────────────────────────────────
    else:
        query_type = "sql"
        sub_agents = ["sql"]

    if "synthesiser" not in sub_agents:
        sub_agents.append("synthesiser")

    step_cit = build_step_citations(
        "router", step_num,
        input_summary=f"Query: {state['query'][:100]}",
        output_summary=f"Classified as '{query_type}', pipeline: {' → '.join(sub_agents)}",
        data_sources=["query_heuristics"],
        confidence=0.85,
    )
    return {
        **state,
        "query_type": query_type,
        "sub_agents": sub_agents,
        "step_citations": [step_cit],
        "errors": [],
        "warnings": [],
    }


# ─────────────────────────────────────────────────────────────────────────────
# SQL NODE — LLM-generated SQL with schema-aware prompt
# ─────────────────────────────────────────────────────────────────────────────
def sql_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    regions = detect_regions_in_query(query)

    user_msg = f"Query: {query}"
    if regions:
        user_msg += f"\nDetected Ghana regions: {', '.join(regions)}"
    user_msg += f"\nQuery type: {state.get('query_type', 'sql')}"

    generated_sql = call_llm_sync(SQL_SYSTEM_PROMPT, user_msg, max_tokens=600)
    generated_sql = generated_sql.strip()
    # Strip any markdown code fences the LLM may emit
    for prefix in ["```sql", "```", "SQL:", "sql:"]:
        if generated_sql.lower().startswith(prefix.lower()):
            generated_sql = generated_sql[len(prefix):].strip()
    if generated_sql.endswith("```"):
        generated_sql = generated_sql[:-3].strip()

    sql_results = []
    error_msg = None

    try:
        from app.services.sql_service import SQLQueryService
        sql_results = _run_async(SQLQueryService.execute_agent_sql(generated_sql))
    except Exception as e:
        error_msg = str(e)
        logger.warning("sql_node_error", error=error_msg[:200], sql=generated_sql[:200])
        # Safe fallback — basic facility list
        try:
            from app.services.sql_service import SQLQueryService
            fallback = f"""
                SELECT name, region_normalised, facility_type_clean, city_clean,
                       has_emergency_medicine, has_surgery, has_icu,
                       medical_desert_score, desert_label,
                       data_completeness_score, number_doctors_int, capacity_int
                FROM {CATALOG}.gold_idp_enriched
                ORDER BY data_completeness_score DESC NULLS LAST
                LIMIT 10
            """
            sql_results = _run_async(SQLQueryService.execute_agent_sql(fallback))
            generated_sql = fallback.strip()
        except Exception:
            sql_results = []

    step_cit = build_step_citations(
        "sql_query", step_num,
        input_summary=f"Query: {query[:100]}",
        output_summary=f"SQL returned {len(sql_results)} rows"
                       + (f" [err: {error_msg[:80]}]" if error_msg else ""),
        data_sources=["gold_idp_enriched", "gold_anomaly_flags",
                      "gold_medical_desert_scores", "gold_regional_summary"],
        confidence=0.9 if not error_msg else 0.5,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "sql_query": generated_sql,
        "sql_results": sql_results,
        "sql_row_count": len(sql_results),
        "step_citations": prev_steps + [step_cit],
        "errors": state.get("errors", []) + ([error_msg] if error_msg else []),
    }


# ─────────────────────────────────────────────────────────────────────────────
# RAG NODE — semantic vector search
# ─────────────────────────────────────────────────────────────────────────────
def rag_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    rag_results = _faiss().search(query, k=8)
    citations = build_citations_from_rag(rag_results)

    top_name = rag_results[0].get("facility_name", "none") if rag_results else "none"
    step_cit = build_step_citations(
        "rag_search", step_num,
        input_summary=f"Semantic search: {query[:100]}",
        output_summary=f"Retrieved {len(rag_results)} facilities. Top: {top_name}",
        data_sources=["faiss_index", "gold_idp_enriched"],
        confidence=0.88,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "rag_results": rag_results,
        "rag_count": len(rag_results),
        "citations": citations,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# GEO NODE — true Haversine geodesic proximity (Q2.1, Q2.3)
# ─────────────────────────────────────────────────────────────────────────────
def geo_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    radius_km = _extract_radius_km(query, default=50.0)

    # Derive center from query text first, then RAG top result, then default to Accra
    # Known Ghana city/landmark → (lat, lon) lookup
    GHANA_CITY_COORDS: dict[str, tuple[float, float]] = {
        "tamale": (9.4075, -0.8533),
        "accra": (5.6037, -0.1870),
        "kumasi": (6.6885, -1.6244),
        "takoradi": (4.8845, -1.7554),
        "sekondi": (4.9346, -1.7026),
        "cape coast": (5.1053, -1.2466),
        "sunyani": (7.3349, -2.3280),
        "wa": (10.0601, -2.5099),
        "bolgatanga": (10.7867, -0.8519),
        "koforidua": (6.0940, -0.2614),
        "ho": (6.6011, 0.4708),
        "tema": (5.6698, -0.0166),
        "techiman": (7.5924, -1.9344),
        "yendi": (9.4427, -0.0094),
        "damongo": (9.0833, -1.8167),
        "bawku": (11.0578, -0.2434),
        "nalerigu": (10.5335, -0.3657),
        "goaso": (6.8001, -2.5167),
        "sefwi wiawso": (6.2145, -2.4833),
        "dambai": (8.0667, 0.1833),
        "keta": (5.9167, 0.9833),
        "hohoe": (7.1547, 0.4743),
        "tarkwa": (5.3047, -2.0006),
        "obuasi": (6.2000, -1.6833),
        "asante mampong": (7.0667, -1.4000),
        "berekum": (7.4500, -2.5833),
        "bekwai": (6.4500, -1.5667),
        "nkoranza": (7.5667, -1.7000),
        "kintampo": (8.0533, -1.7236),
        "bibiani": (6.4667, -2.3333),
    }

    query_lower = query.lower()
    center_city = "Accra"
    center_lat, center_lon = 5.6037, -0.1870

    # 1) Try to match city name in query text
    for city_name, (lat, lon) in GHANA_CITY_COORDS.items():
        if city_name in query_lower:
            center_city = city_name.title()
            center_lat, center_lon = lat, lon
            break

    # 2) If no match yet, try RAG top result
    if center_city == "Accra":
        rag_results = state.get("rag_results", [])
        if rag_results:
            top_meta = rag_results[0].get("metadata", {})
            if top_meta.get("city_clean"):
                center_city = top_meta["city_clean"]
            if top_meta.get("latitude") and top_meta.get("longitude"):
                center_lat = float(top_meta["latitude"])
                center_lon = float(top_meta["longitude"])

    # Generous bounding box for DB fetch, then Haversine filter in Python
    deg_buffer = (radius_km / 111.0) * 1.25

    try:
        from app.services.sql_service import SQLQueryService
        geo_sql = f"""
            SELECT name, city_clean, region_normalised, facility_type_clean,
                   latitude, longitude,
                   has_emergency_medicine, has_surgery, has_icu,
                   has_obstetrics, has_pediatrics, has_radiology,
                   has_infectious_disease, has_mental_health,
                   medical_desert_score, desert_label,
                   number_doctors_int, capacity_int, data_completeness_score,
                   specialties_enriched, procedure_enriched
            FROM {CATALOG}.gold_idp_enriched
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              AND ABS(latitude  - {center_lat}) < {deg_buffer}
              AND ABS(longitude - {center_lon}) < {deg_buffer}
            ORDER BY medical_desert_score ASC NULLS LAST
            LIMIT 200
        """
        raw_results = _run_async(SQLQueryService.execute_agent_sql(geo_sql))
    except Exception as e:
        logger.warning("geo_node_error", error=str(e))
        raw_results = []

    # True geodesic filter
    geo_results = []
    for row in raw_results:
        lat = row.get("latitude")
        lon = row.get("longitude")
        if lat is None or lon is None:
            continue
        dist = _haversine_km(center_lat, center_lon, float(lat), float(lon))
        if dist <= radius_km:
            row["distance_km"] = round(dist, 2)
            geo_results.append(row)

    geo_results.sort(key=lambda r: r.get("distance_km", 9999))

    cold_spots = []
    if len(geo_results) < 3:
        cold_spots.append(f"COLD SPOT: Only {len(geo_results)} facilities within {radius_km:.0f} km of {center_city}")
    no_icu = [r for r in geo_results if not r.get("has_icu")]
    if geo_results and len(no_icu) == len(geo_results):
        cold_spots.append(f"No ICU capability found within {radius_km:.0f} km of {center_city}")
    no_surgery = [r for r in geo_results if not r.get("has_surgery")]
    if geo_results and len(no_surgery) == len(geo_results):
        cold_spots.append(f"No surgical capability found within {radius_km:.0f} km of {center_city}")

    step_cit = build_step_citations(
        "geo_analysis", step_num,
        input_summary=f"Geo search: {center_city} ({center_lat:.3f},{center_lon:.3f}), radius {radius_km:.0f} km",
        output_summary=f"Found {len(geo_results)} facilities. Cold spots: {cold_spots or 'none'}",
        data_sources=["gold_idp_enriched"],
        confidence=0.87,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "geo_center": center_city,
        "geo_radius_km": radius_km,
        "geo_results": geo_results,
        "geo_cold_spots": cold_spots,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# ANOMALY NODE — Q4.x, Q3.1 (dynamic filter based on query intent)
# ─────────────────────────────────────────────────────────────────────────────
def anomaly_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    regions = detect_regions_in_query(query)
    ql = query.lower()

    # Build query-aware WHERE clause
    extra_filters = []
    if any(w in ql for w in ["ghost", "fake", "no doctor", "non-functional"]):
        extra_filters.append("(stat_anomaly_ghost_facility = true OR stat_anomaly_hospital_no_doctors = true)")
    if any(w in ql for w in ["inflat", "unrealistic", "breadth", "procedure", "claim"]):
        extra_filters.append("(stat_anomaly_capability_inflation = true OR stat_anomaly_procedure_breadth = true)")
    if any(w in ql for w in ["equipment", "mismatch", "lack", "without equipment", "minimum"]):
        extra_filters.append("(enhanced_procedures_no_equipment = true OR enhanced_type_capability_mismatch = true)")
    if any(w in ql for w in ["icu", "claim icu", "icu without"]):
        extra_filters.append("(stat_anomaly_clinic_claims_icu = true OR enhanced_icu_no_infrastructure = true)")
    if any(w in ql for w in ["bed", "large bed", "bed count"]):
        extra_filters.append("(enhanced_type_capability_mismatch = true OR stat_anomaly_specialty_mismatch = true)")

    try:
        from app.services.sql_service import SQLQueryService
        region_filter = f"AND region_normalised = '{regions[0]}'" if regions else ""
        extra_clause = f"AND ({' OR '.join(extra_filters)})" if extra_filters else ""

        anm_sql = f"""
            SELECT name, city_clean, region_normalised, facility_type_clean,
                   total_anomaly_flags, anomaly_risk_level,
                   llm_priority_action, llm_data_quality_score,
                   llm_clinical_assessment, llm_false_positive_reason,
                   stat_anomaly_capability_inflation,
                   stat_anomaly_ghost_facility, stat_anomaly_clinic_claims_icu,
                   stat_anomaly_hospital_no_doctors, stat_anomaly_procedure_breadth,
                   stat_anomaly_specialty_mismatch,
                   enhanced_type_capability_mismatch, enhanced_ghost_hospital,
                   enhanced_procedures_no_equipment, enhanced_low_idp_confidence,
                   enhanced_suspicious_completeness, enhanced_icu_no_infrastructure,
                   capability_is_valid, capability_confidence,
                   number_doctors_int, capacity_int,
                   procedure_count, equipment_count, capability_count,
                   medical_desert_score, desert_label
            FROM {CATALOG}.gold_anomaly_flags
            WHERE anomaly_risk_level IN ('CRITICAL', 'HIGH')
            {region_filter} {extra_clause}
            ORDER BY total_anomaly_flags DESC NULLS LAST
            LIMIT 20
        """
        anomaly_results = _run_async(SQLQueryService.execute_agent_sql(anm_sql))
    except Exception as e:
        logger.warning("anomaly_node_error", error=str(e))
        anomaly_results = []

    top_names = [r.get("name", "") for r in anomaly_results[:3]]
    step_cit = build_step_citations(
        "anomaly_check", step_num,
        input_summary=f"Query: {query[:100]}. Regions: {regions or 'all'}",
        output_summary=f"Found {len(anomaly_results)} CRITICAL/HIGH anomalies. Top: {', '.join(top_names) or 'none'}",
        data_sources=["gold_anomaly_flags"],
        confidence=0.92,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "anomaly_results": anomaly_results,
        "anomaly_count": len(anomaly_results),
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# DESERT NODE — Q2.3, Q7.5, Q7.6, Q8.3 regional coverage analysis
# ─────────────────────────────────────────────────────────────────────────────
def desert_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    regions = detect_regions_in_query(query)

    try:
        from app.services.sql_service import SQLQueryService
        region_filter = f"WHERE region = '{regions[0]}'" if regions else ""
        desert_sql = f"""
            SELECT region, medical_desert_score, mds_label, total_facilities,
                   hospital_count, total_doctors, total_beds,
                   missing_critical_specialties,
                   recommended_actions,
                   facilities_per_100k, region_population,
                   region_centroid_lat, region_centroid_lon
            FROM {CATALOG}.gold_medical_desert_scores
            {region_filter}
            ORDER BY medical_desert_score DESC
            LIMIT 17
        """
        desert_results = _run_async(SQLQueryService.execute_agent_sql(desert_sql))

        # Also pull regional summary for capability breakdown
        rs_sql = f"""
            SELECT region_normalised, icu_facilities, surgery_facilities,
                   obstetrics_facilities, emergency_medicine_facilities,
                   radiology_facilities, mental_health_facilities,
                   pediatrics_facilities, infectious_disease_facilities,
                   ngo_count, volunteer_facilities,
                   missing_critical_specialties, critical_specialty_gap_count,
                   total_facilities, medical_desert_score, desert_label
            FROM {CATALOG}.gold_regional_summary
            ORDER BY medical_desert_score DESC NULLS LAST
            LIMIT 17
        """
        regional_summary = _run_async(SQLQueryService.execute_agent_sql(rs_sql))
    except Exception as e:
        logger.warning("desert_node_error", error=str(e))
        desert_results = []
        regional_summary = []

    top_deserts = desert_results[:3] if desert_results else []
    top_region = top_deserts[0].get("region", "N/A") if top_deserts else "N/A"
    top_score = safe_float(top_deserts[0].get("medical_desert_score")) if top_deserts else 0.0

    step_cit = build_step_citations(
        "desert_check", step_num,
        input_summary=f"Desert analysis{' for ' + regions[0] if regions else ' for all regions'}",
        output_summary=f"Retrieved {len(desert_results)} regions. Top: {top_region} (MDS: {top_score:.3f})"
                       if top_deserts else "No desert data",
        data_sources=["gold_medical_desert_scores", "gold_regional_summary"],
        confidence=0.95,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "desert_results": desert_results,
        "desert_top": top_deserts,
        "regional_summary": regional_summary,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# MEDICAL NODE — Q3.4, Q4.3-4.9, Q5.x clinical reasoning
# ─────────────────────────────────────────────────────────────────────────────
def medical_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    context_parts = []
    if state.get("sql_results"):
        context_parts.append(f"SQL findings: {json.dumps(state['sql_results'][:5], default=str)[:600]}")
    if state.get("rag_results"):
        context_parts.append(f"Similar facilities: {[r.get('facility_name') for r in state['rag_results'][:3]]}")
    if state.get("desert_top"):
        context_parts.append(f"Desert regions: {[r.get('region') for r in state['desert_top'][:3]]}")
    if state.get("anomaly_results"):
        top_a = state["anomaly_results"][:3]
        context_parts.append(f"Anomalies: {[(r.get('name'), r.get('anomaly_risk_level')) for r in top_a]}")
    if state.get("regional_summary"):
        context_parts.append(f"Regional summary: {json.dumps(state['regional_summary'][:3], default=str)[:400]}")

    user_msg = f"Query type: {state.get('query_type','')}\nQuery: {state['query']}\n\nData context:\n" + "\n".join(context_parts)
    reasoning = call_llm_sync(MEDICAL_SYSTEM_PROMPT, user_msg, max_tokens=280)

    step_cit = build_step_citations(
        "medical_reasoning", step_num,
        input_summary=f"Clinical analysis of: {state['query'][:100]}",
        output_summary=truncate(reasoning, 200),
        data_sources=["llm_clinical_analysis"],
        confidence=0.78,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "medical_reasoning": reasoning,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# PLANNING NODE — action plans for NGO programme officers
# ─────────────────────────────────────────────────────────────────────────────
def planning_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    context_parts = []
    if state.get("desert_top"):
        context_parts.append(f"Top underserved: {[r.get('region') for r in state['desert_top'][:3]]}")
    if state.get("anomaly_results"):
        context_parts.append(f"High-risk facilities: {[r.get('name') for r in state['anomaly_results'][:3]]}")
    if state.get("sql_results"):
        context_parts.append(f"Key data: {json.dumps(state['sql_results'][:3], default=str)[:400]}")
    if state.get("ngo_results"):
        context_parts.append(f"NGO partners: {[r.get('name') for r in state['ngo_results'][:3]]}")

    user_msg = f"Query: {state['query']}\n\nContext:\n" + "\n".join(context_parts)
    plan = call_llm_sync(PLANNING_SYSTEM_PROMPT, user_msg, max_tokens=400)

    step_cit = build_step_citations(
        "ngo_planning", step_num,
        input_summary=f"Action planning for: {state['query'][:100]}",
        output_summary=truncate(plan, 200),
        data_sources=["llm_planning", "gold_medical_desert_scores", "gold_regional_summary"],
        confidence=0.80,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "action_plan": plan,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# NGO NODE — Q8.x NGO/faith-based analysis
# ─────────────────────────────────────────────────────────────────────────────
def ngo_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    regions = detect_regions_in_query(state["query"])
    ql = state["query"].lower()

    try:
        from app.services.sql_service import SQLQueryService
        region_filter = f"AND region_normalised = '{regions[0]}'" if regions else ""

        ngo_sql = f"""
            SELECT name, city_clean, region_normalised, email, officialWebsite,
                   accepts_volunteers_bool, ngo_serves_ghana,
                   has_emergency_medicine, has_surgery, has_icu, has_obstetrics,
                   medical_desert_score, desert_label,
                   description, organizationdescription,
                   number_doctors_int, data_completeness_score,
                   is_ngo, organization_type_clean
            FROM {CATALOG}.gold_idp_enriched
            WHERE (
                organization_type_clean = 'ngo'
                OR is_ngo = true
                OR LOWER(description) LIKE '%chag%'
                OR LOWER(description) LIKE '%faith%'
                OR LOWER(description) LIKE '%church%'
                OR LOWER(description) LIKE '%mission%'
                OR LOWER(description) LIKE '%outreach%'
                OR LOWER(organizationdescription) LIKE '%chag%'
                OR LOWER(organizationdescription) LIKE '%faith%'
                OR LOWER(organizationdescription) LIKE '%mission%'
                OR LOWER(organizationdescription) LIKE '%international%'
            ) {region_filter}
            ORDER BY data_completeness_score DESC NULLS LAST
            LIMIT 25
        """
        ngo_results = _run_async(SQLQueryService.execute_agent_sql(ngo_sql))

        # For Q8.3 — also pull desert regions with no/few NGOs
        gap_sql = f"""
            SELECT d.region, d.medical_desert_score, d.mds_label,
                   d.total_facilities, d.total_doctors,
                   d.critical_specialties_missing,
                   COALESCE(r.ngo_count, 0) as ngo_count
            FROM {CATALOG}.gold_medical_desert_scores d
            LEFT JOIN {CATALOG}.gold_regional_summary r
              ON d.region = r.region_normalised
            WHERE d.medical_desert_score > 0.4
            ORDER BY d.medical_desert_score DESC, ngo_count ASC
            LIMIT 17
        """
        ngo_gap_results = _run_async(SQLQueryService.execute_agent_sql(gap_sql))
    except Exception as e:
        logger.warning("ngo_node_error", error=str(e))
        ngo_results = []
        ngo_gap_results = []

    step_cit = build_step_citations(
        "ngo_search", step_num,
        input_summary=f"NGO/faith-based search for: {state['query'][:100]}",
        output_summary=f"Found {len(ngo_results)} NGO/faith-based facilities; {len(ngo_gap_results)} gap regions",
        data_sources=["gold_idp_enriched", "gold_medical_desert_scores"],
        confidence=0.90,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "ngo_results": ngo_results,
        "ngo_gap_results": ngo_gap_results,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# WORKFORCE NODE — Q6.x visiting vs permanent specialists
# ─────────────────────────────────────────────────────────────────────────────
def workforce_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    regions = detect_regions_in_query(query)
    ql = query.lower()

    visiting_mode = any(w in ql for w in [
        "visiting", "itinerant", "outreach", "camp", "temporary",
        "periodic", "refer", "visiting surgeon", "visiting consultant",
        "named surgeon", "tied to individual", "fragility",
    ])

    try:
        from app.services.sql_service import SQLQueryService
        region_filter = f"AND region_normalised = '{regions[0]}'" if regions else ""

        if visiting_mode:
            # Q6.4, Q6.5, Q6.6 — detect itinerant language in doc_text
            wf_sql = f"""
                SELECT name, city_clean, region_normalised, facility_type_clean,
                       number_doctors_int, specialty_count, procedure_count,
                       has_surgery, has_icu, has_obstetrics, has_radiology,
                       medical_desert_score, desert_label,
                       data_completeness_score, doc_text, description
                FROM {CATALOG}.gold_idp_enriched
                WHERE is_rag_ready = true
                  AND (
                    LOWER(doc_text) LIKE '%visiting%'
                    OR LOWER(doc_text) LIKE '%itinerant%'
                    OR LOWER(doc_text) LIKE '%outreach%'
                    OR LOWER(doc_text) LIKE '%camp%'
                    OR LOWER(doc_text) LIKE '%visiting surgeon%'
                    OR LOWER(doc_text) LIKE '%visiting consultant%'
                    OR LOWER(description) LIKE '%visiting%'
                    OR LOWER(description) LIKE '%itinerant%'
                    OR LOWER(description) LIKE '%outreach%'
                  ) {region_filter}
                ORDER BY data_completeness_score DESC NULLS LAST
                LIMIT 25
            """
        else:
            # Q6.1 — general workforce distribution by region
            wf_sql = f"""
                SELECT region_normalised, total_doctors, avg_doctors,
                       total_facilities, hospital_count, clinic_count,
                       surgery_facilities, icu_facilities, obstetrics_facilities,
                       emergency_medicine_facilities, radiology_facilities,
                       mental_health_facilities, infectious_disease_facilities,
                       pediatrics_facilities, volunteer_facilities, ngo_count,
                       medical_desert_score, desert_label,
                       missing_critical_specialties, critical_specialty_gap_count
                FROM {CATALOG}.gold_regional_summary
                ORDER BY avg_doctors DESC NULLS LAST
                LIMIT 17
            """

        workforce_results = _run_async(SQLQueryService.execute_agent_sql(wf_sql))
    except Exception as e:
        logger.warning("workforce_node_error", error=str(e))
        workforce_results = []

    context_parts = [
        f"Query: {query}",
        f"Mode: {'Visiting/itinerant detection (Q6.4-6.6)' if visiting_mode else 'Regional workforce distribution (Q6.1)'}",
        f"Data ({len(workforce_results)} rows): {json.dumps(workforce_results[:5], default=str)[:600]}",
    ]
    if state.get("sql_results"):
        context_parts.append(f"SQL context: {json.dumps(state['sql_results'][:3], default=str)[:400]}")

    reasoning = call_llm_sync(WORKFORCE_SYSTEM_PROMPT, "\n".join(context_parts), max_tokens=256)

    step_cit = build_step_citations(
        "workforce_analysis", step_num,
        input_summary=f"Workforce ({'visiting' if visiting_mode else 'distribution'}): {query[:100]}",
        output_summary=f"{len(workforce_results)} records. {truncate(reasoning, 120)}",
        data_sources=["gold_idp_enriched" if visiting_mode else "gold_regional_summary"],
        confidence=0.82,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "workforce_results": workforce_results,
        "workforce_reasoning": reasoning,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# RESOURCE NODE — Q7.x procedure scarcity / oversupply / equipment gaps
# ─────────────────────────────────────────────────────────────────────────────
def resource_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    ql = query.lower()

    # Scarcity queries: which procedures have only 1-2 facilities
    CRITICAL_PROCEDURES = [
        ("cardiac surgery", "cardiac surg"),
        ("cataract surgery", "cataract"),
        ("corneal transplant", "corneal"),
        ("renal dialysis", "dialys"),
        ("neurosurgery", "neurosurg"),
        ("laparoscopy", "laparoscop"),
        ("endoscopy", "endoscop"),
        ("radiation therapy", "radiation therap"),
        ("chemotherapy", "chemother"),
        ("bone marrow transplant", "bone marrow"),
        ("cochlear implant", "cochlear"),
        ("craniofacial surgery", "craniofacial"),
        ("liver transplant", "liver transplant"),
        ("kidney transplant", "kidney transplant"),
        ("cardiac catheterization", "cardiac catheter"),
        ("trauma surgery", "trauma surg"),
        ("burn treatment", "burn treat"),
        ("sickle cell management", "sickle cell"),
        ("dialysis", "dialys"),
        ("ICU ventilation", "ventilat"),
    ]

    procedure_counts = []
    try:
        from app.services.sql_service import SQLQueryService
        # Build UNION ALL query for scarcity analysis
        union_parts = []
        for label, keyword in CRITICAL_PROCEDURES:
            union_parts.append(
                f"SELECT '{label}' AS procedure_name, COUNT(*) AS facility_count "
                f"FROM {CATALOG}.gold_idp_enriched "
                f"WHERE LOWER(procedure_enriched) LIKE '%{keyword}%' "
                f"OR LOWER(capability_enriched) LIKE '%{keyword}%'"
            )
        scarcity_sql = " UNION ALL ".join(union_parts) + " ORDER BY facility_count ASC"
        procedure_counts = _run_async(SQLQueryService.execute_agent_sql(scarcity_sql, max_rows=30))
    except Exception as e:
        logger.warning("resource_node_scarcity_error", error=str(e))

    # Oversupply vs scarcity by region — use regional summary
    regional_resource = []
    try:
        from app.services.sql_service import SQLQueryService
        rs_sql = f"""
            SELECT region_normalised,
                   total_facilities, hospital_count, clinic_count,
                   surgery_facilities, icu_facilities, obstetrics_facilities,
                   radiology_facilities, mental_health_facilities,
                   emergency_medicine_facilities, pediatrics_facilities,
                   infectious_disease_facilities,
                   facilities_with_procedures, facilities_with_equipment,
                   medical_desert_score, desert_label,
                   missing_critical_specialties
            FROM {CATALOG}.gold_regional_summary
            ORDER BY medical_desert_score DESC NULLS LAST
        """
        regional_resource = _run_async(SQLQueryService.execute_agent_sql(rs_sql))
    except Exception as e:
        logger.warning("resource_node_regional_error", error=str(e))

    # Build LLM analysis
    single_points = [r for r in procedure_counts if safe_float(r.get("facility_count")) <= 2]
    context_parts = [
        f"Query: {query}",
        f"Single-point-of-failure procedures (≤2 facilities): {json.dumps(single_points, default=str)[:400]}",
        f"All procedure scarcity: {json.dumps(procedure_counts[:10], default=str)[:400]}",
        f"Regional resource coverage: {json.dumps(regional_resource[:5], default=str)[:400]}",
    ]
    if state.get("sql_results"):
        context_parts.append(f"SQL results: {json.dumps(state['sql_results'][:3], default=str)[:300]}")
    if state.get("desert_top"):
        context_parts.append(f"Desert regions: {[r.get('region') for r in state['desert_top'][:3]]}")

    reasoning = call_llm_sync(RESOURCE_SYSTEM_PROMPT, "\n".join(context_parts), max_tokens=280)

    step_cit = build_step_citations(
        "resource_analysis", step_num,
        input_summary=f"Resource analysis: {query[:100]}",
        output_summary=f"{len(single_points)} single-point procedures. {truncate(reasoning, 120)}",
        data_sources=["gold_idp_enriched", "gold_regional_summary"],
        confidence=0.85,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "resource_results": procedure_counts,
        "resource_single_points": single_points,
        "resource_regional": regional_resource,
        "resource_reasoning": reasoning,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION NODE — Q3.x procedure-equipment co-occurrence, corroboration
# ─────────────────────────────────────────────────────────────────────────────
def validation_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]

    try:
        from app.services.sql_service import SQLQueryService

        # Q3.1 / Q3.4 — facilities claiming procedure but lacking minimum equipment
        validation_sql = f"""
            SELECT name, region_normalised, facility_type_clean,
                   capability_is_valid, capability_confidence,
                   capability_anomalies,
                   enhanced_procedures_no_equipment,
                   stat_anomaly_capability_inflation,
                   procedure_count, equipment_count,
                   procedure_enriched, equipment_enriched,
                   specialties_enriched,
                   llm_clinical_assessment,
                   anomaly_risk_level, total_anomaly_flags,
                   data_completeness_score,
                   medical_desert_score
            FROM {CATALOG}.gold_anomaly_flags
            WHERE enhanced_procedures_no_equipment = true
               OR capability_is_valid = false
               OR capability_confidence < 0.5
            ORDER BY total_anomaly_flags DESC NULLS LAST
            LIMIT 30
        """
        validation_results = _run_async(SQLQueryService.execute_agent_sql(validation_sql))

        # Count: how many claim X but have equipment? (aggregates for % calculation)
        summary_sql = f"""
            SELECT
                COUNT(*) AS total_facilities,
                SUM(CASE WHEN enhanced_procedures_no_equipment = true THEN 1 ELSE 0 END) AS no_equipment_claims,
                SUM(CASE WHEN capability_is_valid = false THEN 1 ELSE 0 END) AS invalid_capabilities,
                SUM(CASE WHEN capability_confidence < 0.5 THEN 1 ELSE 0 END) AS low_confidence,
                SUM(CASE WHEN capability_confidence >= 0.8 THEN 1 ELSE 0 END) AS high_confidence,
                AVG(capability_confidence) AS avg_capability_confidence,
                AVG(data_completeness_score) AS avg_completeness
            FROM {CATALOG}.gold_anomaly_flags
        """
        validation_summary = _run_async(SQLQueryService.execute_agent_sql(summary_sql))
    except Exception as e:
        logger.warning("validation_node_error", error=str(e))
        validation_results = []
        validation_summary = []

    context_parts = [
        f"Query: {query}",
        f"Summary stats: {json.dumps(validation_summary, default=str)[:300]}",
        f"Facilities with equipment-procedure mismatches ({len(validation_results)} found): "
        f"{json.dumps(validation_results[:5], default=str)[:600]}",
    ]
    if state.get("rag_results"):
        context_parts.append(f"RAG context: {[r.get('facility_name') for r in state['rag_results'][:3]]}")
    if state.get("sql_results"):
        context_parts.append(f"SQL results: {json.dumps(state['sql_results'][:3], default=str)[:400]}")

    reasoning = call_llm_sync(VALIDATION_SYSTEM_PROMPT, "\n".join(context_parts), max_tokens=280)

    step_cit = build_step_citations(
        "validation_check", step_num,
        input_summary=f"Validation analysis: {query[:100]}",
        output_summary=f"{len(validation_results)} mismatched facilities. {truncate(reasoning, 120)}",
        data_sources=["gold_anomaly_flags"],
        confidence=0.88,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "validation_results": validation_results,
        "validation_summary": validation_summary,
        "validation_reasoning": reasoning,
        "step_citations": prev_steps + [step_cit],
    }


# ─────────────────────────────────────────────────────────────────────────────
# SYNTHESISER NODE — final answer generation
# ─────────────────────────────────────────────────────────────────────────────
def synthesiser_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    start = time.monotonic()

    context = [
        f"USER QUERY: {state['query']}",
        f"QUERY TYPE: {state.get('query_type', 'unknown')}",
    ]
    history = state.get("chat_history", [])
    if history:
        context.append("\nRECENT HISTORY (most recent first):")
        for h in history[:3]:
            context.append(f"- Q: {h.get('query','')} | A: {truncate(h.get('answer',''), 140)}")

    if state.get("sql_results"):
        context.append(f"\nSQL RESULTS ({state.get('sql_row_count', 0)} rows):")
        context.append(json.dumps(state["sql_results"][:12], default=str, indent=2)[:2000])

    if state.get("rag_results"):
        context.append(f"\nSEMANTIC SEARCH ({state.get('rag_count', 0)} facilities):")
        for r in state["rag_results"][:4]:
            context.append(f"- {r.get('facility_name','?')} in {r.get('region','')} (score: {r.get('score',0):.3f})")

    if state.get("geo_results"):
        geo_all = state["geo_results"]
        context.append(f"\nGEO RESULTS (center: {state.get('geo_center')}, radius: {state.get('geo_radius_km')}km):")
        context.append(f"Total facilities found within radius: {len(geo_all)}")
        # Show ALL facilities sorted by distance, clearly marking capabilities
        for r in geo_all[:15]:
            caps = []
            if r.get("has_obstetrics"): caps.append("OBS")
            if r.get("has_surgery"): caps.append("SUR")
            if r.get("has_icu"): caps.append("ICU")
            if r.get("has_emergency_medicine"): caps.append("EM")
            if r.get("has_pediatrics"): caps.append("PED")
            if r.get("has_radiology"): caps.append("RAD")
            context.append(
                f"- {r.get('name')} — {r.get('distance_km','?')} km | "
                f"{r.get('city_clean','')}, {r.get('region_normalised','')} | "
                f"{r.get('facility_type_clean','')} | caps: {', '.join(caps) or 'none'}"
            )
        # Separately highlight OBS-capable facilities for the LLM
        obs_facilities = [r for r in geo_all if r.get("has_obstetrics")]
        if obs_facilities:
            context.append(f"\nFACILITIES WITH OBSTETRICS within {state.get('geo_radius_km')}km of {state.get('geo_center')}:")
            for r in obs_facilities:
                context.append(
                    f"  ✓ {r.get('name')} — {r.get('distance_km','?')} km | "
                    f"{r.get('city_clean','')}, {r.get('region_normalised','')}"
                )
        else:
            context.append(f"\n⚠ NO facilities with obstetrics found within {state.get('geo_radius_km')}km of {state.get('geo_center')}")
        if state.get("geo_cold_spots"):
            for cs in state["geo_cold_spots"]:
                context.append(f"⚠ COLD SPOT: {cs}")

    if state.get("anomaly_results"):
        context.append(f"\nANOMALY FINDINGS ({state.get('anomaly_count')} critical/high risk):")
        for r in state["anomaly_results"][:6]:
            flags = []
            if r.get("stat_anomaly_ghost_facility"): flags.append("ghost_facility")
            if r.get("stat_anomaly_capability_inflation"): flags.append("capability_inflation")
            if r.get("stat_anomaly_procedure_breadth"): flags.append("procedure_breadth")
            if r.get("enhanced_procedures_no_equipment"): flags.append("no_equipment")
            if r.get("enhanced_type_capability_mismatch"): flags.append("type_mismatch")
            if r.get("stat_anomaly_clinic_claims_icu"): flags.append("clinic_claims_icu")
            if r.get("enhanced_icu_no_infrastructure"): flags.append("icu_no_infra")
            if r.get("stat_anomaly_hospital_no_doctors"): flags.append("no_doctors")
            context.append(
                f"- **{r.get('name')}** ({r.get('anomaly_risk_level')}) "
                f"flags=[{', '.join(flags) or 'none'}] | "
                f"procs: {r.get('procedure_count','?')}, equip: {r.get('equipment_count','?')} | "
                f"assessment: {truncate(r.get('llm_clinical_assessment',''), 100)}"
            )

    if state.get("desert_top"):
        context.append("\nMEDICAL DESERT TOP REGIONS:")
        for d in state["desert_top"]:
            missing = d.get("critical_specialties_missing", "")
            context.append(
                f"- **{d.get('region')}**: MDS {safe_float(d.get('medical_desert_score')):.3f} "
                f"({d.get('mds_label')}) | doctors: {d.get('total_doctors','?')} | "
                f"facilities: {d.get('total_facilities','?')} | missing: {str(missing)[:80]}"
            )

    if state.get("regional_summary"):
        context.append("\nREGIONAL CAPABILITY SUMMARY (top 5 desert regions):")
        for r in state["regional_summary"][:5]:
            context.append(
                f"- {r.get('region_normalised')}: ICU={r.get('icu_facilities',0)}, "
                f"Surgery={r.get('surgery_facilities',0)}, "
                f"OBS={r.get('obstetrics_facilities',0)}, "
                f"NGO={r.get('ngo_count',0)}"
            )

    if state.get("medical_reasoning"):
        context.append(f"\nCLINICAL REASONING:\n{state['medical_reasoning']}")

    if state.get("action_plan"):
        context.append(f"\nNGO ACTION PLAN:\n{state['action_plan']}")

    if state.get("ngo_results"):
        context.append(f"\nNGO/FAITH-BASED FACILITIES: {len(state['ngo_results'])} found")
        for r in state["ngo_results"][:4]:
            context.append(
                f"- {r.get('name')} ({r.get('region_normalised')}) "
                f"volunteers: {r.get('accepts_volunteers_bool')}"
            )
    if state.get("ngo_gap_results"):
        context.append("\nNGO COVERAGE GAPS (high-need regions with low NGO presence):")
        for r in state["ngo_gap_results"][:5]:
            context.append(
                f"- {r.get('region')}: MDS={safe_float(r.get('medical_desert_score')):.3f}, "
                f"NGOs={r.get('ngo_count',0)}"
            )

    if state.get("workforce_results") is not None:
        context.append(f"\nWORKFORCE DATA ({len(state['workforce_results'])} records):")
        if state.get("workforce_reasoning"):
            context.append(f"Analysis: {state['workforce_reasoning']}")
        context.append(json.dumps(state["workforce_results"][:5], default=str)[:600])

    if state.get("resource_results") is not None:
        single_pts = state.get("resource_single_points", [])
        context.append(f"\nPROCEDURE SCARCITY (Q7.5):")
        if single_pts:
            context.append(f"SINGLE POINTS OF FAILURE (≤2 facilities): {json.dumps(single_pts, default=str)[:300]}")
        context.append(f"Full procedure scarcity data: {json.dumps(state['resource_results'][:8], default=str)[:400]}")
        if state.get("resource_reasoning"):
            context.append(f"Resource analysis: {state['resource_reasoning']}")

    if state.get("validation_results") is not None:
        summary = state.get("validation_summary", [{}])
        context.append(f"\nVALIDATION RESULTS (Q3.x):")
        context.append(f"Stats: {json.dumps(summary, default=str)[:200]}")
        context.append(f"{len(state['validation_results'])} facilities with equipment/procedure mismatches")
        if state.get("validation_reasoning"):
            context.append(f"Validation analysis: {state['validation_reasoning']}")

    if state.get("web_results"):
        context.append(f"\nWEB SEARCH (query: '{state.get('web_search_query', '')}'):")
        for w in state["web_results"][:4]:
            context.append(f"- [{w.get('source','')}] {w.get('title','')}: {truncate(w.get('snippet',''), 200)}")

    context.append("\nErrors: " + str(state.get("errors", [])))

    answer = call_llm_sync(
        SYNTHESISER_SYSTEM_PROMPT,
        "\n".join(context),
        max_tokens=800,
        temperature=0.1,
    )
    processing_time = time.monotonic() - start

    all_citations = list(state.get("citations", []))
    if state.get("sql_results") and not all_citations:
        all_citations = build_citations_from_sql(state["sql_results"], state.get("query_type", "sql"))

    step_cit = build_step_citations(
        "synthesiser", step_num,
        input_summary=f"Synthesising {len(context)} context elements",
        output_summary=f"Generated {len(answer)} char answer",
        data_sources=["llm_synthesis", "all_nodes"],
        confidence=0.95,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "answer": answer,
        "citations": all_citations[:8],
        "step_citations": prev_steps + [step_cit],
        "processing_time_s": round(processing_time, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# ROUTING HELPERS
# ─────────────────────────────────────────────────────────────────────────────
_NODE_MAP = {
    "sql": "sql_query",
    "rag": "rag_search",
    "geo": "geo_calc",
    "anomaly": "anomaly_check",
    "desert": "desert_check",
    "medical": "medical_reason",
    "planning": "planning_sys",
    "ngo": "ngo_search",
    "workforce": "workforce_analysis",
    "resource": "resource_check",
    "validation": "validation_check",
    "web": "web_search",
    "synthesiser": "synthesiser",
}


def route_after_router(state: AgentState) -> str:
    """Determine which node to run first after the router."""
    sub_agents = state.get("sub_agents", [])
    if not sub_agents:
        return "synthesiser"
    first = sub_agents[0]
    if first == "web" and not state.get("use_web_search", False):
        return "synthesiser"
    return _NODE_MAP.get(first, "synthesiser")
