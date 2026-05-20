# ============================================================================
# AGENT API MODULE — SSE Streaming Endpoint
# ============================================================================
# This module defines the FastAPI routes (endpoints) that the frontend uses to
# interact with the VIRTUE foundation's AI agent.  It supports:
#   1. POST /agent/query       — Submit a natural-language question and get a
#                                streaming (SSE) or synchronous JSON response.
#   2. GET  /agent/suggestions — Fetch a list of suggested example queries so
#                                users know what kinds of questions to ask.
#   3. GET  /agent/history     — Retrieve past chat messages for a session.
#   4. DELETE /agent/history   — Clear the chat history for a session.
#   5. GET  /agent/health      — Health-check endpoint to verify the agent is
#                                loaded and ready.
#
# Architecture overview:
#   Frontend (React) → FastAPI Router (this file) → Agent Service (LangGraph)
#                                              → SQL Service (Databricks)
#                                              → Chat History Service
# ============================================================================

# --- Standard library imports ------------------------------------------------
# `from __future__ import annotations` enables PEP 563 postponed evaluation of
# annotations, allowing us to use type hints like `list[str]` without wrapping
# them in quotes even on older Python versions.
from __future__ import annotations

# `json` — used implicitly by FastAPI/Pydantic for JSON serialization of
# request/response bodies.  Imported here for potential manual JSON handling.
import json

# `time` — available for adding timestamps or measuring processing duration if
# needed in future enhancements.
import time

# `Optional` from typing — used to annotate variables that may be `None`.
# Example: `Optional[str]` means the value is either a `str` or `None`.
from typing import Optional

# --- Third-party imports (FastAPI & Pydantic) ---------------------------------
# `APIRouter` — a FastAPI class that lets us group related routes together.
# We create one router here and it will be mounted into the main FastAPI app
# (usually in `main.py`) via `app.include_router(router, prefix="/api")`.
from fastapi import APIRouter, HTTPException

# `StreamingResponse` — a special FastAPI response class that streams data to
# the client in real time.  Used for Server-Sent Events (SSE) so the frontend
# can display the agent's answer token-by-token as it is generated.
# `JSONResponse` — returns a standard JSON HTTP response (used for non-streaming
# mode and for simple endpoints like health checks).
from fastapi.responses import StreamingResponse, JSONResponse

# `BaseModel` — the base class from Pydantic that we use to define request and
# response schemas.  Pydantic automatically validates incoming JSON against
# these schemas and returns helpful error messages when validation fails.
# `field_validator` — a decorator that lets us attach custom validation logic
# to individual fields in a Pydantic model.
from pydantic import BaseModel, field_validator

# --- Internal application imports ---------------------------------------------
# `stream_agent_response` — an async generator function (defined in
# `agent_service.py`) that yields SSE-formatted chunks as the LangGraph agent
# produces them.  Each chunk is a string like: `data: {"token": "Hello"}\n\n`
# `invoke_agent_sync` — a synchronous-style async function that runs the agent
# to completion and returns the full result as a dictionary.
from app.services.agent_service import stream_agent_response, invoke_agent_sync

# `get_history` — retrieves the last N chat messages for a given session ID
# from the chat history store (could be in-memory, Redis, or a database).
# `clear_history` — deletes all stored messages for a given session ID.
from app.services.chat_history_service import get_history, clear_history

# `SQLQueryService` — a service class that wraps Databricks SQL queries.
# `get_suggested_queries()` is a static/class method that returns a curated
# list of example questions the user can click to explore the data.
from app.services.sql_service import SQLQueryService

# --- Router instantiation -----------------------------------------------------
# Create an APIRouter instance.  All routes defined below with `@router.<method>`
# will be registered on this router.  The main FastAPI app will later mount it,
# typically under a prefix like `/api`, making the full path e.g. `/api/agent/query`.
router = APIRouter()


# ============================================================================
# REQUEST & RESPONSE SCHEMAS (Pydantic Models)
# ============================================================================

class AgentQueryRequest(BaseModel):
    """Schema for the POST /agent/query request body.

    When the frontend sends a POST request to `/agent/query`, FastAPI
    automatically parses the JSON body and validates it against this schema.

    Example JSON request body:
        {
            "query": "How many hospitals are in Accra?",
            "session_id": "user-123",
            "stream": true,
            "include_map": false,
            "max_results": 10
        }
    """

    # `query` — The natural-language question the user typed.
    # Type: str (required, no default value)
    # Example: "Show me all clinics in the Northern Region"
    query: str

    # `session_id` — A unique identifier for the user's conversation session.
    # Used to maintain chat history across multiple turns.
    # Type: str, defaults to "default" if not provided.
    # Example: "session-abc-123" or "default"
    session_id: str = "default"

    # `stream` — Whether the client wants a streaming (SSE) response or a
    # single JSON response.  When `true`, the server sends chunks as they
    # are generated.  When `false`, the server waits for the full answer.
    # Type: bool, defaults to True (streaming is the preferred UX).
    stream: bool = True

    # `include_map` — Whether the agent should include map/visualization data
    # in its response (e.g., GeoJSON for facility locations).
    # Type: bool, defaults to False.
    include_map: bool = False

    # `max_results` — Maximum number of SQL query results to return.
    # The agent passes this to the SQL service to LIMIT query results.
    # Type: int, defaults to 10.
    max_results: int = 10
    web_search_enabled: bool = False

    # --- Custom field validator for `query` -----------------------------------
    # The `@field_validator("query")` decorator tells Pydantic to run this
    # method automatically whenever an `AgentQueryRequest` is created.
    # `@classmethod` means the method receives the class (`cls`) as its first
    # argument instead of an instance (`self`).
    #
    # Validation logic:
    #   1. Strip leading/trailing whitespace from the query.
    #   2. Reject queries shorter than 3 characters (too short to be meaningful).
    #   3. Reject queries longer than 2000 characters (prevent abuse / token limits).
    #   4. Return the cleaned query string.
    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        # Step 1: Remove leading and trailing whitespace.
        # Example: "  hello  " → "hello"
        v = v.strip()

        # Step 2: Check minimum length.
        # If the query is less than 3 characters after stripping, raise a
        # ValueError.  Pydantic converts this into a 422 Unprocessable Entity
        # HTTP response with a JSON error body.
        # Example: "hi" → raises ValueError("Query must be at least 3 characters")
        if len(v) < 3:
            raise ValueError("Query must be at least 3 characters")

        # Step 3: Check maximum length.
        # Prevents excessively long queries that could overwhelm the LLM or
        # exceed token limits.
        # Example: a 3000-character string → raises ValueError
        if len(v) > 2000:
            raise ValueError("Query must be under 2000 characters")

        # Step 4: Return the validated (and stripped) query.
        # Pydantic assigns this back to the `query` field.
        return v


class ChatHistoryEntry(BaseModel):
    """Schema for a single chat history entry returned by GET /agent/history.

    Each entry represents one turn of conversation (one user question + one
    agent answer).  This model is used to serialize the history items into
    JSON for the frontend.

    Example JSON response item:
        {
            "id": "msg-001",
            "query": "How many hospitals?",
            "answer": "There are 45 hospitals...",
            "query_type": "sql",
            "processing_time_s": 2.34,
            "citations_count": 3,
            "created_at": 1714857600000
        }
    """

    # `id` — Unique identifier for this chat message (e.g., a UUID or
    # auto-incremented ID from the history store).
    id: str

    # `query` — The original user question text.
    query: str

    # `answer` — The agent's full response text.
    answer: str

    # `query_type` — A label indicating how the agent classified the query.
    # Examples: "sql" (answered via SQL), "rag" (answered via RAG/vector search),
    #           "general" (answered from general knowledge).
    query_type: str

    # `processing_time_s` — How long (in seconds) the agent took to generate
    # the response.  Useful for performance monitoring.
    # Example: 2.5 means the agent took 2.5 seconds.
    processing_time_s: float

    # `citations_count` — Number of source citations or references the agent
    # included in its answer (e.g., number of documents retrieved from RAG).
    citations_count: int

    # `created_at` — Unix timestamp (in milliseconds) of when this message
    # was created.  The frontend can convert this to a human-readable date.
    # Example: 1714857600000 → "2024-05-04 12:00:00 UTC"
    created_at: int


# ============================================================================
# API ROUTE HANDLERS
# ============================================================================

@router.post("/agent/query")
async def agent_query(req: AgentQueryRequest):
    """Handle POST /agent/query — the main endpoint for asking questions.

    This endpoint supports TWO response modes based on the `stream` field
    in the request body:

    Mode 1 — Streaming (SSE, when stream=True):
        The server opens a persistent connection and sends chunks of the
        agent's response as they are generated.  The frontend receives these
        in real time using the EventSource API, creating a "typing" effect.

        SSE format: each chunk is a string like:
            data: {"token": "Hello"}\n\n

    Mode 2 — Synchronous JSON (when stream=False):
        The server waits for the agent to produce the complete answer, then
        returns it as a single JSON object.

    Args:
        req: An AgentQueryRequest object automatically parsed and validated
             from the incoming JSON request body by FastAPI/Pydantic.

    Returns:
        Either a StreamingResponse (SSE) or a JSONResponse.
    """

    # Check if the client requested streaming mode.
    # `req.stream` is a bool field from the request body (defaults to True).
    if req.stream:
        # --- Streaming mode (SSE) ---
        # Define an inner async generator function `generate()`.
        # This function is called by StreamingResponse to produce the response
        # body chunk by chunk.
        async def generate():
            # `stream_agent_response` is an async generator that yields
            # SSE-formatted strings as the LangGraph agent produces tokens.
            #
            # `async for` iterates over each chunk as it becomes available.
            # Each `chunk` is already formatted as an SSE message string,
            # e.g.: 'data: {"token": "There"}\n\n'
            #
            # `yield chunk` sends that chunk to the client immediately,
            # without waiting for the full response.
            async for chunk in stream_agent_response(req.query, req.session_id, req.web_search_enabled):
                yield chunk

        # Return a StreamingResponse that wraps our generator.
        # The `media_type="text/event-stream"` header tells the browser to
        # interpret the response as Server-Sent Events.
        return StreamingResponse(
            generate(),  # The async generator that produces SSE chunks
            media_type="text/event-stream",
            headers={
                # "Cache-Control: no-cache" — tells proxies and browsers not to
                # cache the streaming response, since each request is unique.
                "Cache-Control": "no-cache",

                # "X-Accel-Buffering: no" — disables Nginx response buffering.
                # Without this, Nginx might buffer the entire SSE stream before
                # sending it to the client, defeating the purpose of streaming.
                "X-Accel-Buffering": "no",

                # "Connection: keep-alive" — keeps the TCP connection open so
                # that multiple SSE chunks can be sent over the same connection.
                "Connection": "keep-alive",

                # "Access-Control-Allow-Origin: *" — CORS header that allows
                # the frontend (which may be on a different domain/port) to
                # access this endpoint.  In production, you might restrict this
                # to specific origins instead of "*".
                "Access-Control-Allow-Origin": "*",
            },
        )
    else:
        # --- Synchronous (non-streaming) mode ---
        # `invoke_agent_sync` runs the LangGraph agent to completion and
        # returns the full result as a dictionary.
        #
        # Example result:
        #   {
        #       "answer": "There are 45 hospitals in Accra.",
        #       "query_type": "sql",
        #       "citations": [...],
        #       "processing_time_s": 2.1
        #   }
        result = await invoke_agent_sync(req.query, req.session_id, req.web_search_enabled)

        # Return the result as a standard JSON HTTP response.
        # `JSONResponse` automatically serializes the dict to JSON and sets
        # the Content-Type header to "application/json".
        return JSONResponse(content=result)


@router.get("/agent/suggestions")
async def get_suggestions():
    """Handle GET /agent/suggestions — return example queries for the UI.

    The frontend calls this endpoint to populate a "suggested questions" list
    so users know what kinds of questions they can ask.  For example:
        - "How many hospitals are in the Greater Accra region?"
        - "Which facilities have ICU capability?"
        - "Show me clinics without doctors"

    Returns:
        A JSON object with a "suggestions" key containing a list of strings.
        Example: {"suggestions": ["How many hospitals?", "Show me clinics?"]}
    """

    # Call the SQLQueryService to get the list of suggested queries.
    # This is an async method that may read from a config file, database, or
    # hardcoded list of example questions.
    suggestions = await SQLQueryService.get_suggested_queries()

    # Return the suggestions wrapped in a JSON object.
    # FastAPI automatically serializes this dict to JSON.
    return {"suggestions": suggestions}


@router.get("/agent/history")
async def agent_history(session_id: str = "default", limit: int = 20):
    """Handle GET /agent/history — retrieve past chat messages for a session.

    The frontend calls this when a user opens the chat panel to show their
    previous conversation history.

    Query parameters:
        session_id: Unique identifier for the conversation session.
                    Defaults to "default".  Example: "user-123-session"
        limit:      Maximum number of history entries to return.
                    Defaults to 20.  Must be between 1 and 100.

    Returns:
        A JSON object containing the session ID and a list of chat entries.
        Example:
        {
            "session_id": "user-123",
            "items": [
                {
                    "id": "msg-001",
                    "query": "How many hospitals?",
                    "answer": "There are 45...",
                    "query_type": "sql",
                    "processing_time_s": 2.34,
                    "citations_count": 3,
                    "created_at": 1714857600000
                },
                ...
            ]
        }
    """

    # --- Validate the `limit` parameter ----------------------------------------
    # Ensure `limit` is within the acceptable range [1, 100].
    # If not, raise an HTTP 400 Bad Request error with a descriptive message.
    # Example: limit=0 → HTTP 400 with detail="limit must be between 1 and 100"
    # Example: limit=150 → HTTP 400 with detail="limit must be between 1 and 100"
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 100")

    # Fetch the chat history from the history service.
    # `get_history` returns a list of dictionaries, where each dict represents
    # one chat turn (question + answer).
    # Example return: [{"id": "1", "query": "...", "answer": "...", ...}, ...]
    items = await get_history(session_id, limit)

    # Convert each raw history dictionary into a validated ChatHistoryEntry
    # Pydantic model, then serialize it back to a dict using `.model_dump()`.
    #
    # This two-step process (dict → Pydantic model → dict) ensures that:
    #   1. All required fields are present (validation).
    #   2. The output JSON has a consistent, well-defined schema.
    #
    # List comprehension iterates over all history items:
    #   `ChatHistoryEntry(**i)` — unpacks dict `i` into the Pydantic model.
    #   `.model_dump()` — converts the model back to a plain dict for JSON.
    return {
        "session_id": session_id,
        "items": [ChatHistoryEntry(**i).model_dump() for i in items],
    }


@router.delete("/agent/history")
async def clear_agent_history(session_id: str = "default"):
    """Handle DELETE /agent/history — clear all chat history for a session.

    The frontend calls this when the user clicks "Clear chat" or starts a
    new conversation.  All stored messages for the given session are deleted.

    Query parameters:
        session_id: Unique identifier for the conversation session.
                    Defaults to "default".

    Returns:
        A JSON confirmation object.
        Example: {"session_id": "user-123", "cleared": true}
    """

    # Call the history service to delete all messages for this session.
    # This is an async operation that may involve deleting from a database
    # or clearing an in-memory cache.
    await clear_history(session_id)

    # Return a confirmation response so the frontend knows the operation
    # succeeded.
    return {"session_id": session_id, "cleared": True}


@router.get("/agent/health")
async def agent_health():
    """Handle GET /agent/health — check if the agent is loaded and ready.

    The frontend or a monitoring system can call this endpoint to verify
    that the LangGraph agent has been successfully initialized at startup.

    Returns:
        A JSON object indicating agent readiness.
        Example (healthy):  {"agent_ready": true, "graph_nodes": 10}
        Example (unhealthy): {"agent_ready": false, "graph_nodes": 0}
    """

    # Import the VIRTUE_AGENT singleton from the graph module.
    # This is imported inside the function (lazy import) to avoid circular
    # import issues at module load time.  The agent is a global variable
    # that is initialized once when the application starts up.
    from app.agents.graph import VIRTUE_AGENT

    # Build and return the health status dictionary.
    # `VIRTUE_AGENT is not None` — checks whether the agent was successfully
    # created during startup.  If initialization failed, this would be `None`.
    # `graph_nodes: 10 if VIRTUE_AGENT else 0` — reports the number of nodes
    # in the LangGraph workflow when the agent is ready, or 0 if not.
    from app.agents.graph import _ALL_NODES
    node_count = len(_ALL_NODES) if VIRTUE_AGENT else 0
    return {
        "agent_ready": VIRTUE_AGENT is not None,
        "graph_nodes": node_count,
    }
