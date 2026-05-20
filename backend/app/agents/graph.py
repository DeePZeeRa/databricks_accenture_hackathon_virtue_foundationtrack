"""LangGraph compiled agent graph."""
from __future__ import annotations

import structlog
from langgraph.graph import StateGraph, END

from app.agents.state import AgentState
from app.agents.nodes import (
    router_node,
    sql_node,
    rag_node,
    geo_node,
    anomaly_node,
    desert_node,
    medical_node,
    planning_node,
    ngo_node,
    synthesiser_node,
)
from app.agents.web_search import web_search_node

logger = structlog.get_logger(__name__)


def _build_graph() -> StateGraph:
    """Build and compile the LangGraph agent graph."""
    builder = StateGraph(AgentState)

    # Add all nodes
    builder.add_node("router", router_node)
    builder.add_node("sql_query", sql_node)
    builder.add_node("rag_search", rag_node)
    builder.add_node("geo_calc", geo_node)
    builder.add_node("anomaly_check", anomaly_node)
    builder.add_node("desert_check", desert_node)
    builder.add_node("medical_reason", medical_node)
    builder.add_node("planning_sys", planning_node)
    builder.add_node("ngo_search", ngo_node)
    builder.add_node("web_search", web_search_node)
    builder.add_node("synthesiser", synthesiser_node)

    # Set entry point
    builder.set_entry_point("router")

    # Router → conditional branching based on query type
    builder.add_conditional_edges(
        "router",
        _route_after_router,
        {
            "sql_query": "sql_query",
            "rag_search": "rag_search",
            "geo_calc": "geo_calc",
            "anomaly_check": "anomaly_check",
            "desert_check": "desert_check",
            "medical_reason": "medical_reason",
            "planning_sys": "planning_sys",
            "ngo_search": "ngo_search",
            "web_search": "web_search",
            "synthesiser": "synthesiser",
        },
    )

    # Secondary routing: after sql_query
    builder.add_conditional_edges(
        "sql_query",
        _route_after_sql,
        {
            "anomaly_check": "anomaly_check",
            "desert_check": "desert_check",
            "planning_sys": "planning_sys",
            "ngo_search": "ngo_search",
            "synthesiser": "synthesiser",
        },
    )

    # All secondary nodes go straight to synthesiser
    for node in ["rag_search", "geo_calc", "anomaly_check", "desert_check",
                 "medical_reason", "planning_sys", "ngo_search", "web_search"]:
        builder.add_edge(node, "synthesiser")

    builder.add_edge("synthesiser", END)

    graph = builder.compile()
    logger.info("langgraph_compiled", nodes=11)
    return graph


def _route_after_router(state: AgentState) -> str:
    """Route from router to first agent node."""
    sub_agents = state.get("sub_agents", [])
    if not sub_agents:
        return "synthesiser"
    first = sub_agents[0]

    # If router chose web_search but toggle is off, go straight to synthesiser
    if first == "web" and not state.get("use_web_search", False):
        return "synthesiser"

    _MAP = {
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
    return _MAP.get(first, "synthesiser")


def _route_after_sql(state: AgentState) -> str:
    """Route from sql_query to secondary nodes if needed."""
    sub_agents = state.get("sub_agents", [])
    # Find what comes after "sql" in the list
    if "sql" in sub_agents:
        idx = sub_agents.index("sql")
        remaining = sub_agents[idx + 1:]
        if remaining and remaining[0] != "synthesiser":
            _MAP = {
                "anomaly": "anomaly_check",
                "desert": "desert_check",
                "planning": "planning_sys",
                "ngo": "ngo_search",
            }
            return _MAP.get(remaining[0], "synthesiser")
    return "synthesiser"


# Module-level compiled graph — created once at import time
try:
    VIRTUE_AGENT = _build_graph()
    logger.info("virtue_agent_ready")
except Exception as e:
    logger.error("virtue_agent_build_failed", error=str(e))
    VIRTUE_AGENT = None  # type: ignore
