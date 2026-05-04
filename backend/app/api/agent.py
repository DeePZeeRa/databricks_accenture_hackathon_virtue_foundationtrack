"""Agent API — SSE streaming endpoint."""
from __future__ import annotations

import json
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, field_validator

from app.services.agent_service import stream_agent_response, invoke_agent_sync
from app.services.chat_history_service import get_history, clear_history
from app.services.sql_service import SQLQueryService

router = APIRouter()


class AgentQueryRequest(BaseModel):
    query: str
    session_id: str = "default"
    stream: bool = True
    include_map: bool = False
    max_results: int = 10

    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Query must be at least 3 characters")
        if len(v) > 2000:
            raise ValueError("Query must be under 2000 characters")
        return v


class ChatHistoryEntry(BaseModel):
    id: str
    query: str
    answer: str
    query_type: str
    processing_time_s: float
    citations_count: int
    created_at: int


@router.post("/agent/query")
async def agent_query(req: AgentQueryRequest):
    if req.stream:
        async def generate():
            async for chunk in stream_agent_response(req.query, req.session_id):
                yield chunk

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            },
        )
    else:
        result = await invoke_agent_sync(req.query, req.session_id)
        return JSONResponse(content=result)


@router.get("/agent/suggestions")
async def get_suggestions():
    suggestions = await SQLQueryService.get_suggested_queries()
    return {"suggestions": suggestions}


@router.get("/agent/history")
async def agent_history(session_id: str = "default", limit: int = 20):
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 100")
    items = await get_history(session_id, limit)
    return {"session_id": session_id, "items": [ChatHistoryEntry(**i).model_dump() for i in items]}


@router.delete("/agent/history")
async def clear_agent_history(session_id: str = "default"):
    await clear_history(session_id)
    return {"session_id": session_id, "cleared": True}


@router.get("/agent/health")
async def agent_health():
    from app.agents.graph import VIRTUE_AGENT
    return {
        "agent_ready": VIRTUE_AGENT is not None,
        "graph_nodes": 10 if VIRTUE_AGENT else 0,
    }
