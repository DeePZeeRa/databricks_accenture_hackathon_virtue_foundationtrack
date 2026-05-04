"""Agent service — SSE streaming orchestrator bridging LangGraph and FastAPI."""
from __future__ import annotations

import asyncio
import json
import queue
import time
from concurrent.futures import ThreadPoolExecutor
from typing import AsyncGenerator

import orjson
import structlog

from app.agents.state import AgentState
from app.services.chat_history_service import add_entry, add_entry_sync, build_history_entry, get_history

logger = structlog.get_logger(__name__)

_agent_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="agent")


def _build_chunk(chunk_type: str, content: str, metadata: dict | None = None) -> str:
    """Format a StreamingChunk as an SSE event."""
    chunk = {
        "chunk_type": chunk_type,
        "content": content,
        "metadata": metadata or {},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return f"data: {orjson.dumps(chunk).decode()}\n\n"


async def stream_agent_response(
    query: str,
    session_id: str = "default",
) -> AsyncGenerator[str, None]:
    """
    Stream agent response chunks as SSE events.
    Uses a thread-safe bridge between LangGraph's sync stream and asyncio.
    """
    from app.agents.graph import VIRTUE_AGENT
    from app.core.config import settings

    if VIRTUE_AGENT is None:
        yield _build_chunk("error", "Agent graph not initialized. Check server logs.")
        yield _build_chunk("done", "")
        return

    # Thread-safe queue bridge
    chunk_queue: queue.Queue = queue.Queue()
    loop = asyncio.get_event_loop()
    start_time = time.monotonic()
    history_context: list[dict] = []

    try:
        history_context = await get_history(session_id, settings.chat_history_context_limit)
    except Exception:
        history_context = []

    def _run_agent_sync() -> None:
        """Run LangGraph synchronously inside thread, pushing chunks to queue."""
        initial_state: AgentState = {
            "query": query,
            "session_id": session_id,
            "chat_history": history_context,
            "sub_agents": [],
            "query_type": "",
            "errors": [],
            "warnings": [],
            "citations": [],
            "step_citations": [],
        }

        prev_keys: set = set()
        latest_query_type = ""
        history_saved = False
        try:
            for update in VIRTUE_AGENT.stream(initial_state, stream_mode="updates"):
                if not update:
                    continue

                for node_name, node_state in update.items():
                    # Determine what changed
                    new_keys = set(node_state.keys()) - prev_keys
                    prev_keys |= set(node_state.keys())

                    if node_name == "router":
                        latest_query_type = node_state.get("query_type", "")
                        chunk_queue.put(_build_chunk(
                            "thinking",
                            f"Classified query as '{node_state.get('query_type')}'. Pipeline: {' → '.join(node_state.get('sub_agents', []))}",
                            {"query_type": node_state.get("query_type"), "sub_agents": node_state.get("sub_agents", [])},
                        ))

                    elif node_name == "sql_query":
                        chunk_queue.put(_build_chunk(
                            "sql_result",
                            f"Executed SQL query returning {node_state.get('sql_row_count', 0)} rows",
                            {
                                "row_count": node_state.get("sql_row_count", 0),
                                "preview": node_state.get("sql_results", [])[:3],
                            },
                        ))

                    elif node_name == "rag_search":
                        rag = node_state.get("rag_results", [])
                        preview = [
                            {
                                "name": r.get("facility_name", ""),
                                "region": r.get("region", ""),
                                "score": round(float(r.get("score", 0)), 3),
                            }
                            for r in rag[:4]
                        ]
                        chunk_queue.put(_build_chunk(
                            "rag_result",
                            f"Semantic search matched {len(rag)} facilities",
                            {"count": len(rag), "preview": preview},
                        ))

                    elif node_name == "geo_calc":
                        geo = node_state.get("geo_results", [])
                        chunk_queue.put(_build_chunk(
                            "geo_result",
                            f"Geographic analysis: {len(geo)} facilities within {node_state.get('geo_radius_km', 50)}km of {node_state.get('geo_center', 'unknown')}",
                            {
                                "center": node_state.get("geo_center"),
                                "radius_km": node_state.get("geo_radius_km"),
                                "facility_count": len(geo),
                                "cold_spots": node_state.get("geo_cold_spots", []),
                                "facilities": geo[:5],
                            },
                        ))

                    elif node_name == "anomaly_check":
                        anm = node_state.get("anomaly_results", [])
                        chunk_queue.put(_build_chunk(
                            "anomaly_result",
                            f"Detected {len(anm)} CRITICAL/HIGH anomaly facilities",
                            {"count": len(anm), "facilities": anm[:5]},
                        ))

                    elif node_name == "desert_check":
                        desert = node_state.get("desert_top", [])
                        chunk_queue.put(_build_chunk(
                            "desert_result",
                            f"Top 3 medical deserts: {', '.join([d.get('region','') for d in desert[:3]])}",
                            {"regions": desert[:5]},
                        ))

                    elif node_name == "medical_reason":
                        chunk_queue.put(_build_chunk(
                            "medical_reasoning",
                            node_state.get("medical_reasoning", ""),
                        ))

                    elif node_name == "planning_sys":
                        chunk_queue.put(_build_chunk(
                            "planning",
                            node_state.get("action_plan", ""),
                        ))

                    elif node_name == "synthesiser":
                        elapsed = round(time.monotonic() - start_time, 2)
                        answer = node_state.get("answer", "")
                        citations = node_state.get("citations", [])
                        chunk_queue.put(_build_chunk(
                            "final_answer",
                            answer,
                            {"processing_time_s": elapsed},
                        ))
                        chunk_queue.put(_build_chunk(
                            "citations",
                            json.dumps(citations, default=str),
                            {
                                "citations": citations,
                                "step_citations": node_state.get("step_citations", []),
                            },
                        ))
                        if answer and not history_saved:
                            entry = build_history_entry(
                                query=query,
                                answer=answer,
                                query_type=latest_query_type,
                                processing_time_s=elapsed,
                                citations_count=len(citations or []),
                            )
                            add_entry_sync(session_id, entry)
                            history_saved = True

        except Exception as e:
            logger.error("agent_stream_error", error=str(e))
            chunk_queue.put(_build_chunk("error", f"Agent error: {str(e)[:200]}"))

        finally:
            chunk_queue.put(None)  # Sentinel

    # Start the agent in a thread
    future = loop.run_in_executor(_agent_executor, _run_agent_sync)

    # Bridge thread queue → async generator
    try:
        async with asyncio.timeout(settings.agent_timeout_seconds):
            while True:
                # Poll the thread queue with small sleeps
                try:
                    item = chunk_queue.get_nowait()
                except queue.Empty:
                    await asyncio.sleep(0.05)
                    continue

                if item is None:  # Sentinel
                    break
                yield item

    except TimeoutError:
        elapsed = round(time.monotonic() - start_time, 2)
        yield _build_chunk(
            "error",
            f"Agent timed out after {elapsed}s. Partial results may be available.",
            {"elapsed_s": elapsed},
        )

    except Exception as e:
        yield _build_chunk("error", f"Streaming error: {str(e)[:200]}")

    finally:
        yield _build_chunk("done", "")
        # Ensure future is cleaned up
        if not future.done():
            future.cancel()


async def invoke_agent_sync(query: str, session_id: str = "default") -> dict:
    """Run agent non-streaming — returns complete state."""
    from app.agents.graph import VIRTUE_AGENT
    from app.core.config import settings

    if VIRTUE_AGENT is None:
        return {"error": "Agent not initialized", "answer": ""}

    history_context: list[dict] = []
    try:
        history_context = await get_history(session_id, settings.chat_history_context_limit)
    except Exception:
        history_context = []

    initial_state: AgentState = {
        "query": query,
        "session_id": session_id,
        "chat_history": history_context,
        "sub_agents": [],
        "query_type": "",
        "errors": [],
        "warnings": [],
        "citations": [],
        "step_citations": [],
    }

    loop = asyncio.get_event_loop()
    start_time = time.monotonic()
    try:
        async with asyncio.timeout(settings.agent_timeout_seconds):
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    _agent_executor,
                    lambda: VIRTUE_AGENT.invoke(initial_state),
                ),
                timeout=settings.agent_timeout_seconds,
            )
        result_dict = dict(result)
        elapsed = round(time.monotonic() - start_time, 2)
        answer = result_dict.get("answer", "")
        if answer:
            entry = build_history_entry(
                query=query,
                answer=answer,
                query_type=result_dict.get("query_type", ""),
                processing_time_s=float(result_dict.get("processing_time_s") or elapsed),
                citations_count=len(result_dict.get("citations", []) or []),
            )
            await add_entry(session_id, entry)
        return result_dict
    except TimeoutError:
        return {"error": "Agent timed out", "answer": "The request took too long to complete."}
    except Exception as e:
        logger.error("agent_invoke_error", error=str(e))
        return {"error": str(e), "answer": ""}
