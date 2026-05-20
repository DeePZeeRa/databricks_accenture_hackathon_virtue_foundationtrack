"""LangGraph node implementations — all 11 nodes adapted from notebook 06."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import structlog

from app.agents.state import AgentState
from app.agents.prompts import (
    ROUTER_SYSTEM_PROMPT, SQL_SYSTEM_PROMPT,
    SYNTHESISER_SYSTEM_PROMPT, MEDICAL_SYSTEM_PROMPT, PLANNING_SYSTEM_PROMPT,
)
from app.agents.utils import (
    call_llm_sync, build_citations_from_rag, build_citations_from_sql,
    build_step_citations, truncate, safe_float, detect_regions_in_query,
)

logger = structlog.get_logger(__name__)

CATALOG = "virtue_foundation.ghana"

SPEC_MAP = {
    "surgery": "has_surgery",
    "surgical": "has_surgery",
    "emergency": "has_emergency_medicine",
    "icu": "has_icu",
    "intensive care": "has_icu",
    "obstetrics": "has_obstetrics",
    "maternity": "has_obstetrics",
    "pediatrics": "has_pediatrics",
    "radiology": "has_radiology",
    "infectious disease": "has_infectious_disease",
    "mental health": "has_mental_health",
    "psychiatry": "has_mental_health",
}


def _run_async(coro):
    """Run an async coroutine safely from a sync thread (e.g. LangGraph worker)."""
    import concurrent.futures
    # Is there a running event loop somewhere (e.g. the main uvicorn loop)?
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = None

    if loop is not None and loop.is_running():
        # We're in a worker thread — schedule the coroutine on the running loop
        # and block until it finishes.
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result(timeout=60)
    else:
        # No running loop — safe to use asyncio.run()
        return asyncio.run(coro)


def _faiss():
    from app.services.faiss_service import FAISSIndexManager
    return FAISSIndexManager


# ── 1. Router Node ─────────────────────────────────────────────────────────────
def router_node(state: AgentState) -> AgentState:
    query = state["query"].lower()
    step_num = 1
    query_type = "general"
    sub_agents = []

    if any(w in query for w in ["anomal", "ghost", "suspicious", "fake", "flag", "inconsist"]):
        query_type = "anomaly"; sub_agents = ["sql", "anomaly"]
    elif any(w in query for w in ["desert", "underserv", "gap", "missing special", "critical region", "coverage"]):
        query_type = "desert"; sub_agents = ["sql", "desert"]
    elif any(w in query for w in ["nearest", "closest", "radius", "km away", "distance", "near "]):
        query_type = "geo"; sub_agents = ["rag", "geo"]
    elif any(w in query for w in ["find", "locate", "which", "search", "similar", "like "]):
        query_type = "rag"; sub_agents = ["rag"]
    elif any(w in query for w in ["how many", "count", "total", "list all", "how much", "percentage"]):
        query_type = "sql"; sub_agents = ["sql"]
    elif any(w in query for w in ["plan", "action", "deploy", "allocate", "volunteer", "recommend"]):
        query_type = "planning"; sub_agents = ["sql", "planning"]
    elif any(w in query for w in ["ngo", "charity", "faith", "church", "chag", "mission"]):
        query_type = "ngo"; sub_agents = ["sql", "ngo"]
    elif any(w in query for w in ["why", "clinical", "treat", "patient", "mortality", "risk"]):
        query_type = "medical"; sub_agents = ["rag", "medical"]
    elif any(w in query for w in ["who", "who guideline", "global", "international", "research", "study", "news", "latest", "external", "worldwide", "united nations", "unicef", "world bank"]):
        query_type = "web"; sub_agents = ["web"]
    else:
        query_type = "sql"; sub_agents = ["sql"]

    if "synthesiser" not in sub_agents:
        sub_agents.append("synthesiser")

    step_cit = build_step_citations(
        "router", step_num,
        input_summary=f"Query: {state['query'][:100]}",
        output_summary=f"Classified as '{query_type}', pipeline: {' → '.join(sub_agents)}",
        data_sources=["query_heuristics"],
        confidence=0.85,
    )
    return {**state, "query_type": query_type, "sub_agents": sub_agents,
            "step_citations": [step_cit], "errors": [], "warnings": []}




# # ── 2. SQL Node ────────────────────────────────────────────────────────────────
def sql_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    regions = detect_regions_in_query(query)

    user_msg = f"Query: {query}"
    if regions:
        user_msg += f"\nDetected regions: {', '.join(regions)}"

    generated_sql = call_llm_sync(SQL_SYSTEM_PROMPT, user_msg, max_tokens=512)
    generated_sql = generated_sql.strip()
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
        logger.warning("sql_node_error", error=error_msg, sql=generated_sql[:200])
        try:
            from app.services.sql_service import SQLQueryService
            fallback = f"""
                SELECT name, region_normalised, facility_type_clean, city_clean,
                       has_emergency_medicine, has_surgery, has_icu, medical_desert_score,
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
        output_summary=f"SQL returned {len(sql_results)} rows" + (f" [err: {error_msg[:50]}]" if error_msg else ""),
        data_sources=["gold_idp_enriched", "gold_anomaly_flags", "gold_medical_desert_scores"],
        confidence=0.9 if not error_msg else 0.5,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "sql_query": generated_sql, "sql_results": sql_results,
            "sql_row_count": len(sql_results), "step_citations": prev_steps + [step_cit],
            "errors": state.get("errors", []) + ([error_msg] if error_msg else [])}




# ── 3. RAG Node ────────────────────────────────────────────────────────────────
def rag_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    rag_results = _faiss().search(query, k=8)
    citations = build_citations_from_rag(rag_results)
    step_cit = build_step_citations(
        "rag_search", step_num,
        input_summary=f"Semantic search: {query[:100]}",
        output_summary=f"Retrieved {len(rag_results)} facilities. Top: {rag_results[0]['facility_name'] if rag_results else 'none'}",
        data_sources=["faiss_index", "gold_idp_enriched"],
        confidence=0.88,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "rag_results": rag_results, "rag_count": len(rag_results),
            "citations": citations, "step_citations": prev_steps + [step_cit]}


# ── 4. Geo Node ────────────────────────────────────────────────────────────────
def geo_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    rag_results = state.get("rag_results", [])
    center_city = "Accra"
    center_lat, center_lon = 5.6037, -0.1870

    if rag_results:
        top_meta = rag_results[0].get("metadata", {})
        if top_meta.get("city_clean"): center_city = top_meta["city_clean"]
        if top_meta.get("latitude") and top_meta.get("longitude"):
            center_lat = float(top_meta["latitude"]); center_lon = float(top_meta["longitude"])

    try:
        from app.services.sql_service import SQLQueryService
        radius_deg = 0.45
        geo_sql = f"""
            SELECT name, city_clean, region_normalised, facility_type_clean,
                   latitude, longitude, has_emergency_medicine, has_surgery,
                   medical_desert_score, desert_label, number_doctors_int
            FROM {CATALOG}.gold_idp_enriched
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              AND ABS(latitude - {center_lat}) < {radius_deg}
              AND ABS(longitude - {center_lon}) < {radius_deg}
            ORDER BY medical_desert_score DESC NULLS LAST
            LIMIT 20
        """
        geo_results = _run_async(SQLQueryService.execute_agent_sql(geo_sql))
    except Exception as e:
        logger.warning("geo_node_error", error=str(e)); geo_results = []

    cold_spots = [f"Low coverage near {center_city}"] if len(geo_results) < 3 else []
    step_cit = build_step_citations(
        "geo_analysis", step_num,
        input_summary=f"Geographic search centered on {center_city}",
        output_summary=f"Found {len(geo_results)} facilities within ~50km",
        data_sources=["gold_idp_enriched"], confidence=0.82,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "geo_center": center_city, "geo_radius_km": 50.0,
            "geo_results": geo_results, "geo_cold_spots": cold_spots,
            "step_citations": prev_steps + [step_cit]}



# ── 5. Anomaly Node ────────────────────────────────────────────────────────────
def anomaly_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    regions = detect_regions_in_query(query)
    try:
        from app.services.sql_service import SQLQueryService
        region_filter = f"AND region_normalised = '{regions[0]}'" if regions else ""
        anm_sql = f"""
            SELECT name, city_clean, region_normalised, facility_type_clean,
                   total_anomaly_flags, anomaly_risk_level,
                   llm_priority_action, llm_data_quality_score,
                   llm_clinical_assessment, stat_anomaly_capability_inflation,
                   stat_anomaly_ghost_facility, stat_anomaly_clinic_claims_icu,
                   stat_anomaly_hospital_no_doctors, capability_is_valid
            FROM {CATALOG}.gold_anomaly_flags
            WHERE anomaly_risk_level IN ('CRITICAL', 'HIGH') {region_filter}
            ORDER BY total_anomaly_flags DESC NULLS LAST
            LIMIT 15
        """
        anomaly_results = _run_async(SQLQueryService.execute_agent_sql(anm_sql))
    except Exception as e:
        logger.warning("anomaly_node_error", error=str(e)); anomaly_results = []

    top_names = [r.get("name", "") for r in anomaly_results[:3]]
    step_cit = build_step_citations(
        "anomaly_check", step_num,
        input_summary=f"Query: {query[:100]}",
        output_summary=f"Found {len(anomaly_results)} CRITICAL/HIGH anomalies. Top: {', '.join(top_names) or 'none'}",
        data_sources=["gold_anomaly_flags"], confidence=0.92,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "anomaly_results": anomaly_results, "anomaly_count": len(anomaly_results),
            "step_citations": prev_steps + [step_cit]}

# ── 6. Desert Node ─────────────────────────────────────────────────────────────
def desert_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    try:
        from app.services.sql_service import SQLQueryService
        desert_sql = f"""
            SELECT region, medical_desert_score, mds_label, total_facilities,
                   hospital_count, total_doctors, total_beds,
                   critical_specialties_covered, critical_specialties_missing,
                   recommended_actions, facilities_per_100k, population_estimate
            FROM {CATALOG}.gold_medical_desert_scores
            ORDER BY medical_desert_score DESC LIMIT 17
        """
        desert_results = _run_async(SQLQueryService.execute_agent_sql(desert_sql))
    except Exception as e:
        logger.warning("desert_node_error", error=str(e)); desert_results = []

    top_deserts = desert_results[:3]
    step_cit = build_step_citations(
        "desert_check", step_num,
        input_summary="Fetching medical desert scores",
        output_summary=f"Retrieved {len(desert_results)} regions. Top: {top_deserts[0].get('region','N/A') if top_deserts else 'N/A'}",
        data_sources=["gold_medical_desert_scores"], confidence=0.95,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "desert_results": desert_results, "desert_top": top_deserts,
            "step_citations": prev_steps + [step_cit]}


# ── 7. Medical Node ────────────────────────────────────────────────────────────
def medical_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    context_parts = []
    if state.get("sql_results"):
        context_parts.append(f"SQL findings: {json.dumps(state['sql_results'][:5], default=str)[:500]}")
    if state.get("rag_results"):
        context_parts.append(f"Similar facilities: {[r.get('facility_name') for r in state['rag_results'][:3]]}")
    if state.get("desert_top"):
        context_parts.append(f"Desert regions: {[r.get('region') for r in state['desert_top'][:3]]}")

    user_msg = f"Query: {state['query']}\n\nData context:\n" + "\n".join(context_parts)
    reasoning = call_llm_sync(MEDICAL_SYSTEM_PROMPT, user_msg, max_tokens=256)
    step_cit = build_step_citations(
        "medical_reasoning", step_num,
        input_summary=f"Clinical analysis: {state['query'][:100]}",
        output_summary=truncate(reasoning, 200),
        data_sources=["llm_clinical_analysis"], confidence=0.78,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "medical_reasoning": reasoning, "step_citations": prev_steps + [step_cit]}


# # ── 8. Planning Node ───────────────────────────────────────────────────────────
def planning_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    context_parts = []
    if state.get("desert_top"):
        context_parts.append(f"Top underserved: {[r.get('region') for r in state['desert_top'][:3]]}")
    if state.get("anomaly_results"):
        context_parts.append(f"High-risk facilities: {[r.get('name') for r in state['anomaly_results'][:3]]}")
    if state.get("sql_results"):
        context_parts.append(f"Key data: {json.dumps(state['sql_results'][:3], default=str)[:400]}")

    user_msg = f"Query: {state['query']}\n\nContext:\n" + "\n".join(context_parts)
    plan = call_llm_sync(PLANNING_SYSTEM_PROMPT, user_msg, max_tokens=400)
    step_cit = build_step_citations(
        "ngo_planning", step_num,
        input_summary=f"NGO planning: {state['query'][:100]}",
        output_summary=truncate(plan, 200),
        data_sources=["llm_planning", "gold_medical_desert_scores"], confidence=0.80,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "action_plan": plan, "step_citations": prev_steps + [step_cit]}


# ── 9. NGO Node ────────────────────────────────────────────────────────────────
def ngo_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    try:
        from app.services.sql_service import SQLQueryService
        ngo_sql = f"""
            SELECT name, city_clean, region_normalised, email, officialWebsite,
                   accepts_volunteers_bool, ngo_serves_ghana,
                   has_emergency_medicine, has_surgery, medical_desert_score, description
            FROM {CATALOG}.gold_idp_enriched
            WHERE organization_type_clean = 'ngo' OR is_ngo = true
            ORDER BY data_completeness_score DESC NULLS LAST LIMIT 15
        """
        ngo_results = _run_async(SQLQueryService.execute_agent_sql(ngo_sql))
    except Exception as e:
        logger.warning("ngo_node_error", error=str(e)); ngo_results = []

    step_cit = build_step_citations(
        "ngo_search", step_num,
        input_summary=f"NGO search: {state['query'][:100]}",
        output_summary=f"Found {len(ngo_results)} NGO facilities",
        data_sources=["gold_idp_enriched"], confidence=0.90,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "ngo_results": ngo_results, "step_citations": prev_steps + [step_cit]}

# ── 10. Synthesiser Node ───────────────────────────────────────────────────────
def synthesiser_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    start = time.monotonic()

    context = [f"USER QUERY: {state['query']}", f"QUERY TYPE: {state.get('query_type', 'unknown')}"]
    history = state.get("chat_history", [])
    if history:
        context.append("\nRECENT HISTORY (most recent first):")
        for h in history[:3]:
            context.append(f"- Q: {h.get('query','')} | A: {truncate(h.get('answer',''), 140)}")
    if state.get("sql_results"):
        context.append(f"\nSQL RESULTS ({state.get('sql_row_count', 0)} rows):")
        context.append(json.dumps(state["sql_results"][:10], default=str, indent=2)[:1500])
    if state.get("rag_results"):
        context.append(f"\nSEMANTIC SEARCH ({state.get('rag_count', 0)} matched):")
        for r in state["rag_results"][:4]:
            context.append(f"- {r.get('facility_name','Unknown')} in {r.get('region','')} (score: {r.get('score',0):.3f})")
    if state.get("geo_results"):
        context.append(f"\nGEO: {len(state['geo_results'])} facilities near {state.get('geo_center')}")
    if state.get("anomaly_results"):
        context.append(f"\nANOMALIES ({state.get('anomaly_count')} critical/high):")
        for r in state["anomaly_results"][:5]:
            context.append(f"- {r.get('name')} ({r.get('anomaly_risk_level')}): {truncate(r.get('llm_clinical_assessment',''),100)}")
    if state.get("desert_top"):
        context.append("\nDESERT TOP 3:")
        for d in state["desert_top"]:
            context.append(f"- {d.get('region')}: MDS {safe_float(d.get('medical_desert_score')):.3f} ({d.get('mds_label')})")
    if state.get("medical_reasoning"):
        context.append(f"\nCLINICAL: {state['medical_reasoning']}")
    if state.get("action_plan"):
        context.append(f"\nPLAN: {state['action_plan']}")
    if state.get("ngo_results"):
        context.append(f"\nNGO: {len(state['ngo_results'])} found")
    context.append(f"\nErrors: {state.get('errors',[])}")

    answer = call_llm_sync(SYNTHESISER_SYSTEM_PROMPT, "\n".join(context), max_tokens=600, temperature=0.1)
    processing_time = time.monotonic() - start

    all_citations = list(state.get("citations", []))
    if state.get("sql_results") and not all_citations:
        all_citations = build_citations_from_sql(state["sql_results"], state.get("query_type", "sql"))

    step_cit = build_step_citations(
        "synthesiser", step_num,
        input_summary=f"Synthesising {len(context)} elements",
        output_summary=f"Generated {len(answer)} char answer",
        data_sources=["llm_synthesis"], confidence=0.95,
    )
    prev_steps = state.get("step_citations", [])
    return {**state, "answer": answer, "citations": all_citations[:8],
            "step_citations": prev_steps + [step_cit],
            "processing_time_s": round(processing_time, 2)}


# ── Routing helpers ────────────────────────────────────────────────────────────
def route_after_router(state: AgentState) -> str:
    sub_agents = state.get("sub_agents", [])
    if not sub_agents:
        return "synthesiser"
    first = sub_agents[0]
    return {"sql": "sql_query", "rag": "rag_search", "geo": "geo_calc",
            "anomaly": "anomaly_check", "desert": "desert_check",
            "medical": "medical_reason", "planning": "planning_sys",
            "ngo": "ngo_search", "synthesiser": "synthesiser"}.get(first, "synthesiser")




from app.agents.state import AgentState
from app.agents.prompts import (
    ROUTER_SYSTEM_PROMPT, SQL_SYSTEM_PROMPT,
    SYNTHESISER_SYSTEM_PROMPT, MEDICAL_SYSTEM_PROMPT, PLANNING_SYSTEM_PROMPT,
)
from app.agents.utils import (
    call_llm_sync, build_citations_from_rag, build_citations_from_sql,
    build_step_citations, truncate, safe_float, detect_regions_in_query,
)

logger = structlog.get_logger(__name__)

CATALOG = "virtue_foundation.ghana"

# Specialty detection map for heuristic routing
SPEC_MAP = {
    "surgery": "has_surgery",
    "surgical": "has_surgery",
    "emergency": "has_emergency_medicine",
    "icu": "has_icu",
    "intensive care": "has_icu",
    "obstetrics": "has_obstetrics",
    "maternity": "has_obstetrics",
    "pediatrics": "has_pediatrics",
    "radiology": "has_radiology",
    "infectious disease": "has_infectious_disease",
    "mental health": "has_mental_health",
    "psychiatry": "has_mental_health",
}


def _db():
    """Lazy import to avoid circular deps."""
    from app.core.database import DatabricksQueryExecutor
    return DatabricksQueryExecutor


def _faiss():
    from app.services.faiss_service import FAISSIndexManager
    return FAISSIndexManager


# ── 1. Router Node ─────────────────────────────────────────────────────────────
def router_node(state: AgentState) -> AgentState:
    query = state["query"].lower()
    step_num = 1

    # Heuristic routing first (fast path)
    query_type = "general"
    sub_agents = []

    if any(w in query for w in ["anomal", "ghost", "suspicious", "fake", "flag", "inconsist"]):
        query_type = "anomaly"
        sub_agents = ["sql", "anomaly"]
    elif any(w in query for w in ["desert", "underserv", "gap", "missing special", "critical region", "coverage"]):
        query_type = "desert"
        sub_agents = ["sql", "desert"]
    elif any(w in query for w in ["nearest", "closest", "radius", "km away", "distance", "near "]):
        query_type = "geo"
        sub_agents = ["rag", "geo"]
    elif any(w in query for w in ["find", "locate", "which", "search", "similar", "like "]):
        query_type = "rag"
        sub_agents = ["rag"]
    elif any(w in query for w in ["how many", "count", "total", "list all", "how much", "percentage"]):
        query_type = "sql"
        sub_agents = ["sql"]
    elif any(w in query for w in ["plan", "action", "deploy", "allocate", "volunteer", "recommend"]):
        query_type = "planning"
        sub_agents = ["sql", "planning"]
    elif any(w in query for w in ["ngo", "charity", "faith", "church", "chag", "mission"]):
        query_type = "ngo"
        sub_agents = ["sql", "ngo"]
    elif any(w in query for w in ["why", "clinical", "treat", "patient", "mortality", "risk"]):
        query_type = "medical"
        sub_agents = ["rag", "medical"]
    elif any(w in query for w in ["who guideline", "global", "international", "research", "study", "news", "latest", "external", "worldwide", "united nations", "unicef", "world bank", "who "]):
        query_type = "web"
        sub_agents = ["web"]
    else:
        query_type = "sql"
        sub_agents = ["sql"]

    # Always end with synthesiser
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


# ── 2. SQL Node ────────────────────────────────────────────────────────────────
def sql_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    regions = detect_regions_in_query(query)

    # Generate SQL with LLM
    user_msg = f"Query: {query}"
    if regions:
        user_msg += f"\nDetected regions: {', '.join(regions)}"

    generated_sql = call_llm_sync(SQL_SYSTEM_PROMPT, user_msg, max_tokens=512)

    # Clean up the SQL
    generated_sql = generated_sql.strip()
    for prefix in ["```sql", "```", "SQL:", "sql:"]:
        if generated_sql.lower().startswith(prefix.lower()):
            generated_sql = generated_sql[len(prefix):].strip()
    if generated_sql.endswith("```"):
        generated_sql = generated_sql[:-3].strip()

    sql_results = []
    error_msg = None

    try:
        from app.services.sql_service import SQLQueryService
        # Use the agent SQL executor with security validation
        import asyncio
        sql_results = asyncio.get_event_loop().run_until_complete(
            SQLQueryService.execute_agent_sql(generated_sql)
        )
    except Exception as e:
        error_msg = str(e)
        logger.warning("sql_node_error", error=error_msg, sql=generated_sql[:200])
        # Fallback: try a safe default query based on query type
        try:
            import asyncio
            fallback = f"""
                SELECT name, region_normalised, facility_type_clean, city_clean,
                       has_emergency_medicine, has_surgery, has_icu, medical_desert_score,
                       data_completeness_score, number_doctors_int, capacity_int
                FROM {CATALOG}.gold_idp_enriched
                ORDER BY data_completeness_score DESC NULLS LAST
                LIMIT 10
            """
            sql_results = asyncio.get_event_loop().run_until_complete(
                SQLQueryService.execute_agent_sql(fallback)
            )
            generated_sql = fallback.strip()
        except Exception:
            sql_results = []

    step_cit = build_step_citations(
        "sql_query", step_num,
        input_summary=f"Query: {query[:100]}",
        output_summary=f"Generated SQL returning {len(sql_results)} rows" + (f" [error: {error_msg[:50]}]" if error_msg else ""),
        data_sources=["gold_idp_enriched", "gold_anomaly_flags", "gold_medical_desert_scores"],
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


# ── 3. RAG Node ────────────────────────────────────────────────────────────────
def rag_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]

    rag_results = _faiss().search(query, k=8)
    citations = build_citations_from_rag(rag_results)

    step_cit = build_step_citations(
        "rag_search", step_num,
        input_summary=f"Semantic search: {query[:100]}",
        output_summary=f"Retrieved {len(rag_results)} matching facilities. Top: {rag_results[0]['facility_name'] if rag_results else 'none'}",
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


# ── 4. Geo Node ────────────────────────────────────────────────────────────────
def geo_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]

    # Extract city/location from RAG results or query
    rag_results = state.get("rag_results", [])
    center_city = "Accra"
    center_lat, center_lon = 5.6037, -0.1870

    if rag_results:
        top_meta = rag_results[0].get("metadata", {})
        if top_meta.get("city_clean"):
            center_city = top_meta["city_clean"]
        if top_meta.get("latitude") and top_meta.get("longitude"):
            center_lat = float(top_meta["latitude"])
            center_lon = float(top_meta["longitude"])

    # Find nearby facilities within ~50km radius using Haversine approximation
    radius_deg = 0.45  # ~50km
    try:
        import asyncio
        geo_sql = f"""
            SELECT name, city_clean, region_normalised, facility_type_clean,
                   latitude, longitude, has_emergency_medicine, has_surgery,
                   medical_desert_score, desert_label, number_doctors_int
            FROM {CATALOG}.gold_idp_enriched
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              AND ABS(latitude - {center_lat}) < {radius_deg}
              AND ABS(longitude - {center_lon}) < {radius_deg}
            ORDER BY medical_desert_score DESC NULLS LAST
            LIMIT 20
        """
        from app.services.sql_service import SQLQueryService
        geo_results = asyncio.get_event_loop().run_until_complete(
            SQLQueryService.execute_agent_sql(geo_sql)
        )
    except Exception as e:
        logger.warning("geo_node_error", error=str(e))
        geo_results = []

    # Find cold spots (areas with no facilities)
    cold_spots = []
    if len(geo_results) < 3:
        cold_spots.append(f"Low coverage detected near {center_city}")

    step_cit = build_step_citations(
        "geo_analysis", step_num,
        input_summary=f"Geographic search centered on {center_city} ({center_lat:.2f}, {center_lon:.2f})",
        output_summary=f"Found {len(geo_results)} facilities within ~50km. Cold spots: {cold_spots or 'none'}",
        data_sources=["gold_idp_enriched"],
        confidence=0.82,
    )

    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "geo_center": center_city,
        "geo_radius_km": 50.0,
        "geo_results": geo_results,
        "geo_cold_spots": cold_spots,
        "step_citations": prev_steps + [step_cit],
    }


# ── 5. Anomaly Node ────────────────────────────────────────────────────────────
def anomaly_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    query = state["query"]
    regions = detect_regions_in_query(query)

    try:
        import asyncio
        region_filter = f"AND region_normalised = '{regions[0]}'" if regions else ""
        anm_sql = f"""
            SELECT name, city_clean, region_normalised, facility_type_clean,
                   total_anomaly_flags, anomaly_risk_level,
                   llm_priority_action, llm_data_quality_score,
                   llm_clinical_assessment, stat_anomaly_capability_inflation,
                   stat_anomaly_ghost_facility, stat_anomaly_clinic_claims_icu,
                   stat_anomaly_hospital_no_doctors, capability_is_valid
            FROM {CATALOG}.gold_anomaly_flags
            WHERE anomaly_risk_level IN ('CRITICAL', 'HIGH') {region_filter}
            ORDER BY total_anomaly_flags DESC NULLS LAST, llm_data_quality_score ASC NULLS LAST
            LIMIT 15
        """
        from app.services.sql_service import SQLQueryService
        anomaly_results = asyncio.get_event_loop().run_until_complete(
            SQLQueryService.execute_agent_sql(anm_sql)
        )
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


# ── 6. Desert Node ─────────────────────────────────────────────────────────────
def desert_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1

    try:
        import asyncio
        desert_sql = f"""
            SELECT region, medical_desert_score, mds_label, total_facilities,
                   hospital_count, total_doctors, total_beds,
                   critical_specialties_covered, critical_specialties_missing,
                   recommended_actions, facilities_per_100k, population_estimate
            FROM {CATALOG}.gold_medical_desert_scores
            ORDER BY medical_desert_score DESC
            LIMIT 17
        """
        from app.services.sql_service import SQLQueryService
        desert_results = asyncio.get_event_loop().run_until_complete(
            SQLQueryService.execute_agent_sql(desert_sql)
        )
    except Exception as e:
        logger.warning("desert_node_error", error=str(e))
        desert_results = []

    top_deserts = desert_results[:3] if desert_results else []

    step_cit = build_step_citations(
        "desert_check", step_num,
        input_summary="Fetching medical desert scores for all regions",
        output_summary=f"Retrieved {len(desert_results)} regions. Top desert: {top_deserts[0].get('region', 'N/A') if top_deserts else 'N/A'} (MDS: {safe_float(top_deserts[0].get('medical_desert_score')):.3f})" if top_deserts else "No desert data",
        data_sources=["gold_medical_desert_scores"],
        confidence=0.95,
    )

    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "desert_results": desert_results,
        "desert_top": top_deserts,
        "step_citations": prev_steps + [step_cit],
    }


# ── 7. Medical Reasoning Node ──────────────────────────────────────────────────
def medical_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1

    # Build context from available data
    context_parts = []
    if state.get("sql_results"):
        context_parts.append(f"SQL findings: {json.dumps(state['sql_results'][:5], default=str)[:500]}")
    if state.get("rag_results"):
        context_parts.append(f"Similar facilities: {[r.get('facility_name') for r in state['rag_results'][:3]]}")
    if state.get("desert_top"):
        context_parts.append(f"Desert regions: {[r.get('region') for r in state['desert_top'][:3]]}")

    user_msg = f"Query: {state['query']}\n\nData context:\n" + "\n".join(context_parts)
    reasoning = call_llm_sync(MEDICAL_SYSTEM_PROMPT, user_msg, max_tokens=256)

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


# ── 8. Planning Node ───────────────────────────────────────────────────────────
def planning_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1

    context_parts = []
    if state.get("desert_top"):
        top = state["desert_top"]
        context_parts.append(f"Top underserved regions: {[r.get('region') for r in top[:3]]}")
    if state.get("anomaly_results"):
        context_parts.append(f"High-risk facilities: {[r.get('name') for r in state['anomaly_results'][:3]]}")
    if state.get("sql_results"):
        context_parts.append(f"Key data: {json.dumps(state['sql_results'][:3], default=str)[:400]}")

    user_msg = f"Query: {state['query']}\n\nContext:\n" + "\n".join(context_parts)
    plan = call_llm_sync(PLANNING_SYSTEM_PROMPT, user_msg, max_tokens=400)

    step_cit = build_step_citations(
        "ngo_planning", step_num,
        input_summary=f"NGO action planning for: {state['query'][:100]}",
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


# ── 9. NGO Node ────────────────────────────────────────────────────────────────
def ngo_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1

    try:
        import asyncio
        ngo_sql = f"""
            SELECT name, city_clean, region_normalised, email, officialWebsite,
                   accepts_volunteers_bool, ngo_serves_ghana,
                   has_emergency_medicine, has_surgery, medical_desert_score,
                   description
            FROM {CATALOG}.gold_idp_enriched
            WHERE organization_type_clean = 'ngo' OR is_ngo = true
            ORDER BY data_completeness_score DESC NULLS LAST
            LIMIT 15
        """
        from app.services.sql_service import SQLQueryService
        ngo_results = asyncio.get_event_loop().run_until_complete(
            SQLQueryService.execute_agent_sql(ngo_sql)
        )
    except Exception as e:
        logger.warning("ngo_node_error", error=str(e))
        ngo_results = []

    step_cit = build_step_citations(
        "ngo_search", step_num,
        input_summary=f"NGO facility search for: {state['query'][:100]}",
        output_summary=f"Found {len(ngo_results)} NGO facilities",
        data_sources=["gold_idp_enriched"],
        confidence=0.90,
    )

    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "ngo_results": ngo_results,
        "step_citations": prev_steps + [step_cit],
    }


# ── 10. Synthesiser Node ───────────────────────────────────────────────────────
def synthesiser_node(state: AgentState) -> AgentState:
    step_num = len(state.get("step_citations", [])) + 1
    start = time.monotonic()

    # Build comprehensive context for synthesiser
    context = []
    context.append(f"USER QUERY: {state['query']}")
    context.append(f"QUERY TYPE: {state.get('query_type', 'unknown')}")
    history = state.get("chat_history", [])
    if history:
        context.append("\nRECENT HISTORY (most recent first):")
        for h in history[:3]:
            context.append(f"- Q: {h.get('query','')} | A: {truncate(h.get('answer',''), 140)}")

    if state.get("sql_results"):
        context.append(f"\nSQL RESULTS ({state.get('sql_row_count', 0)} rows):")
        context.append(json.dumps(state["sql_results"][:10], default=str, indent=2)[:1500])

    if state.get("rag_results"):
        context.append(f"\nSEMANTIC SEARCH ({state.get('rag_count', 0)} facilities matched):")
        for r in state["rag_results"][:4]:
            context.append(f"- {r.get('facility_name', 'Unknown')} in {r.get('region', '')} (score: {r.get('score', 0):.3f})")

    if state.get("geo_results"):
        context.append(f"\nGEOGRAPHIC RESULTS (center: {state.get('geo_center')}, radius: {state.get('geo_radius_km')}km):")
        context.append(f"Found {len(state['geo_results'])} facilities nearby")

    if state.get("anomaly_results"):
        context.append(f"\nANOMALY FINDINGS ({state.get('anomaly_count')} critical/high risk):")
        for r in state["anomaly_results"][:5]:
            context.append(f"- {r.get('name')} ({r.get('anomaly_risk_level')}): {truncate(r.get('llm_clinical_assessment', ''), 100)}")

    if state.get("desert_top"):
        context.append("\nMEDICAL DESERT TOP 3:")
        for d in state["desert_top"]:
            context.append(f"- {d.get('region')}: MDS {safe_float(d.get('medical_desert_score')):.3f} ({d.get('mds_label')})")

    if state.get("medical_reasoning"):
        context.append(f"\nCLINICAL REASONING: {state['medical_reasoning']}")

    if state.get("action_plan"):
        context.append(f"\nNGO ACTION PLAN: {state['action_plan']}")

    if state.get("ngo_results"):
        context.append(f"\nNGO FACILITIES: {len(state['ngo_results'])} found")

    if state.get("web_results"):
        context.append(f"\nWEB SEARCH RESULTS (query: '{state.get('web_search_query', '')}'):")
        for w in state["web_results"][:5]:
            context.append(f"- [{w.get('source','')}] {w.get('title','')}: {truncate(w.get('snippet',''), 200)} (URL: {w.get('url','')})") 

    context.append("\nErrors during processing: " + str(state.get("errors", [])))

    full_context = "\n".join(context)
    answer = call_llm_sync(
        SYNTHESISER_SYSTEM_PROMPT,
        full_context,
        max_tokens=600,
        temperature=0.1,
    )

    processing_time = time.monotonic() - start

    # Build final citations
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


# ── Routing function ───────────────────────────────────────────────────────────
def route_after_router(state: AgentState) -> str:
    """Determine which node to run next based on sub_agents list."""
    sub_agents = state.get("sub_agents", [])
    if not sub_agents:
        return "synthesiser"

    # Remove the first agent and return it
    next_agent = sub_agents[0]
    # Map to node names
    NODE_MAP = {
        "sql": "sql_query",
        "rag": "rag_search",
        "geo": "geo_calc",
        "anomaly": "anomaly_check",
        "desert": "desert_check",
        "medical": "medical_reason",
        "planning": "planning_sys",
        "ngo": "ngo_search",
        "web": "web_search",
        "synthesiser": "synthesiser",
    }
    return NODE_MAP.get(next_agent, "synthesiser")
