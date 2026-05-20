"""LangGraph AgentState definition — covers all 59 MoSCoW question categories."""
from __future__ import annotations

from typing import Any, Optional
from typing_extensions import TypedDict


class AgentState(TypedDict, total=False):
    """State shared across all LangGraph nodes."""
    # Input
    query: str
    session_id: str
    chat_history: list[dict]

    # Routing
    query_type: str          # sql|rag|geo|anomaly|desert|medical|planning|ngo|workforce|resource|validation|general
    sub_agents: list[str]    # ordered list of nodes to invoke

    # SQL node
    sql_query: str
    sql_results: list[dict]
    sql_row_count: int

    # RAG node
    rag_results: list[dict]
    rag_count: int

    # Geo node
    geo_center: Optional[str]
    geo_radius_km: float
    geo_results: list[dict]
    geo_cold_spots: list[str]

    # Map node
    map_data: dict

    # Anomaly node (Q4.x)
    anomaly_results: list[dict]
    anomaly_count: int

    # Desert node (Q2.3, Q7.5, Q8.3)
    desert_results: list[dict]
    desert_top: list[dict]
    regional_summary: list[dict]   # from gold_regional_summary (capability breakdown)

    # Medical reasoning node (Q3.4, Q4.3-4.9, Q5.x)
    medical_reasoning: str

    # Planning node
    action_plan: str

    # NGO node (Q8.x)
    ngo_results: list[dict]
    ngo_gap_results: list[dict]    # desert regions with no/few NGOs

    # Workforce node (Q6.x)
    workforce_results: list[dict]
    workforce_reasoning: str

    # Resource node (Q7.x)
    resource_results: list[dict]         # procedure scarcity counts
    resource_single_points: list[dict]   # procedures at ≤2 facilities
    resource_regional: list[dict]        # regional coverage breakdown
    resource_reasoning: str

    # Validation node (Q3.x)
    validation_results: list[dict]       # facilities with equipment mismatches
    validation_summary: list[dict]       # aggregate stats
    validation_reasoning: str

    # Web search node
    use_web_search: bool    # controlled by frontend toggle
    web_results: list[dict]
    web_search_query: str

    # Synthesiser
    answer: str
    citations: list[dict]
    step_citations: list[dict]
    mlflow_run_id: str
    processing_time_s: float

    # Error tracking
    errors: list[str]
    warnings: list[str]
