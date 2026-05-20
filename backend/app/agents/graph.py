"""LangGraph compiled agent graph — 14 nodes covering all 59 MoSCoW questions."""
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
    workforce_node,
    resource_node,
    validation_node,
    synthesiser_node,
)
from app.agents.web_search import web_search_node

logger = structlog.get_logger(__name__)

# ── Node name constants ────────────────────────────────────────────────────────
_ALL_NODES = [
    "router",
    "sql_query",
    "rag_search",
    "geo_calc",
    "anomaly_check",
    "desert_check",
    "medical_reason",
    "planning_sys",
    "ngo_search",
    "workforce_analysis",
    "resource_check",
    "validation_check",
    "web_search",
    "synthesiser",
]

# Mapping from sub_agent token → graph node name
_AGENT_TO_NODE = {
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

# Nodes that route BACK to another node via post-SQL chaining
_POST_SQL_NODES = {
    "anomaly": "anomaly_check",
    "desert": "desert_check",
    "planning": "planning_sys",
    "ngo": "ngo_search",
    "workforce": "workforce_analysis",
    "resource": "resource_check",
    "validation": "validation_check",
    "medical": "medical_reason",
}

# Leaf nodes — flow directly to synthesiser
_LEAF_NODES = [
    "rag_search", "geo_calc", "anomaly_check", "desert_check",
    "medical_reason", "planning_sys", "ngo_search",
    "workforce_analysis", "resource_check", "validation_check",
    "web_search",
]


def _route_after_router(state: AgentState) -> str:
    """Route from router to the first agent node in sub_agents."""
    sub_agents = state.get("sub_agents", [])
    if not sub_agents:
        return "synthesiser"
    first = sub_agents[0]
    if first == "web" and not state.get("use_web_search", False):
        return "synthesiser"
    return _AGENT_TO_NODE.get(first, "synthesiser")


def _route_after_sql(state: AgentState) -> str:
    """After sql_query, check if there's a secondary node to chain into."""
    sub_agents = state.get("sub_agents", [])
    if "sql" in sub_agents:
        idx = sub_agents.index("sql")
        remaining = sub_agents[idx + 1:]
        for token in remaining:
            if token != "synthesiser":
                node = _POST_SQL_NODES.get(token)
                if node:
                    return node
    return "synthesiser"


def _route_after_rag(state: AgentState) -> str:
    """After rag_search, check if geo or validation follows."""
    sub_agents = state.get("sub_agents", [])
    if "rag" in sub_agents:
        idx = sub_agents.index("rag")
        remaining = sub_agents[idx + 1:]
        for token in remaining:
            if token not in ("rag", "synthesiser"):
                node = _AGENT_TO_NODE.get(token)
                if node:
                    return node
    return "synthesiser"


def _build_graph() -> StateGraph:
    builder = StateGraph(AgentState)

    # Register all nodes
    builder.add_node("router",             router_node)
    builder.add_node("sql_query",          sql_node)
    builder.add_node("rag_search",         rag_node)
    builder.add_node("geo_calc",           geo_node)
    builder.add_node("anomaly_check",      anomaly_node)
    builder.add_node("desert_check",       desert_node)
    builder.add_node("medical_reason",     medical_node)
    builder.add_node("planning_sys",       planning_node)
    builder.add_node("ngo_search",         ngo_node)
    builder.add_node("workforce_analysis", workforce_node)
    builder.add_node("resource_check",     resource_node)
    builder.add_node("validation_check",   validation_node)
    builder.add_node("web_search",         web_search_node)
    builder.add_node("synthesiser",        synthesiser_node)

    # Entry
    builder.set_entry_point("router")

    # Router → conditional first node
    builder.add_conditional_edges(
        "router",
        _route_after_router,
        {node: node for node in _ALL_NODES if node != "router"},
    )

    # SQL → conditional second node (chains to anomaly/desert/workforce/etc.)
    builder.add_conditional_edges(
        "sql_query",
        _route_after_sql,
        {
            "anomaly_check":      "anomaly_check",
            "desert_check":       "desert_check",
            "planning_sys":       "planning_sys",
            "ngo_search":         "ngo_search",
            "workforce_analysis": "workforce_analysis",
            "resource_check":     "resource_check",
            "validation_check":   "validation_check",
            "medical_reason":     "medical_reason",
            "synthesiser":        "synthesiser",
        },
    )

    # RAG → conditional second node (chains to geo or validation)
    builder.add_conditional_edges(
        "rag_search",
        _route_after_rag,
        {
            "geo_calc":       "geo_calc",
            "validation_check": "validation_check",
            "medical_reason": "medical_reason",
            "workforce_analysis": "workforce_analysis",
            "synthesiser":    "synthesiser",
        },
    )

    # All leaf nodes flow to synthesiser
    for node in _LEAF_NODES:
        if node not in ("rag_search",):   # rag has conditional edge above
            builder.add_edge(node, "synthesiser")

    builder.add_edge("synthesiser", END)

    graph = builder.compile()
    logger.info("langgraph_compiled", nodes=len(_ALL_NODES))
    return graph


# Module-level compiled graph — created once at startup
try:
    VIRTUE_AGENT = _build_graph()
    logger.info("virtue_agent_ready", nodes=len(_ALL_NODES))
except Exception as e:
    logger.error("virtue_agent_build_failed", error=str(e))
    VIRTUE_AGENT = None  # type: ignore
