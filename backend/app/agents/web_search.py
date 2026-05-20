"""Web search node using DuckDuckGo Instant Answer API — no API key required."""
from __future__ import annotations

import json
import time
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

_DDGO_URL = "https://api.duckduckgo.com/"
_TIMEOUT = 6.0


def _ddg_search(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    """Query DuckDuckGo Instant Answer API synchronously using httpx."""
    try:
        import httpx
        params = {
            "q": query,
            "format": "json",
            "no_html": "1",
            "skip_disambig": "1",
            "no_redirect": "1",
        }
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.get(_DDGO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning("ddg_search_error", error=str(e), query=query[:80])
        return []

    results: list[dict[str, Any]] = []
    timestamp = int(time.time())

    # Abstract (top answer)
    abstract = data.get("Abstract", "").strip()
    if abstract:
        results.append({
            "title": data.get("Heading", "Overview"),
            "snippet": abstract[:400],
            "url": data.get("AbstractURL", ""),
            "source": data.get("AbstractSource", "DuckDuckGo"),
            "timestamp": timestamp,
        })

    # Related topics
    for topic in data.get("RelatedTopics", []):
        if len(results) >= max_results:
            break
        if isinstance(topic, dict) and topic.get("Text"):
            text = topic["Text"].strip()
            url = ""
            first_url = topic.get("FirstURL", "")
            results.append({
                "title": text[:60] + ("..." if len(text) > 60 else ""),
                "snippet": text[:300],
                "url": first_url,
                "source": "DuckDuckGo Related",
                "timestamp": timestamp,
            })

    # Results section (if present)
    for r in data.get("Results", []):
        if len(results) >= max_results:
            break
        if r.get("Text"):
            results.append({
                "title": r.get("Text", "")[:60],
                "snippet": r.get("Text", "")[:300],
                "url": r.get("FirstURL", ""),
                "source": "DuckDuckGo Result",
                "timestamp": timestamp,
            })

    return results[:max_results]


def web_search_node(state: dict) -> dict:
    """LangGraph node: performs web search and populates web_results in state."""
    from app.agents.utils import build_step_citations

    query = state.get("query", "")
    step_num = len(state.get("step_citations", [])) + 1

    # Build a focused search query with Ghana healthcare context
    search_query = f"Ghana healthcare {query}"

    results = _ddg_search(search_query, max_results=5)

    step_cit = build_step_citations(
        "web_search", step_num,
        input_summary=f"Web search: {search_query[:100]}",
        output_summary=f"Retrieved {len(results)} web results",
        data_sources=["duckduckgo_web"],
        confidence=0.65,
    )
    prev_steps = state.get("step_citations", [])
    return {
        **state,
        "web_results": results,
        "web_search_query": search_query,
        "step_citations": prev_steps + [step_cit],
    }
