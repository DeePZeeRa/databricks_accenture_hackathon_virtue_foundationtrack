"""LangGraph AgentState definition."""
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
    query_type: str          # sql | rag | geo | anomaly | desert | medical | planning | ngo | general
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

    # Anomaly node
    anomaly_results: list[dict]
    anomaly_count: int

    # Desert node
    desert_results: list[dict]
    desert_top: list[dict]

    # Medical reasoning node
    medical_reasoning: str

    # Planning node
    action_plan: str

    # NGO node
    ngo_results: list[dict]

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
