# Bridging Medical Deserts — Virtue FoundationTrack (Databricks + Accenture Hackathon)

An agentic healthcare intelligence prototype that identifies "medical deserts" and connects clinical expertise to the places that need it most. Built for the Databricks + Accenture Virtue FoundationTrack hackathon, this project demonstrates an Intelligent Document Parsing (IDP) agent + RAG pipeline that extracts, verifies and reasons over messy facility data to power NGO planning and forensic audits of care capacity.

Key outcomes
- Extract structured medical capability facts from unstructured facility text (procedures, equipment, capabilities).
- Identify gaps and anomalous claims about services (anomaly detection + rule checks).
- Produce region-level medical desert scores and visual maps to guide investments and deployments.
- Provide an agentic planner and IDP agent interface for natural-language queries, with row-level citations for traceability.

Live demo (example)
- Backend (Render): https://databricks-accenture-hackathon-virtue.onrender.com
- Frontend (Vercel): https://databricks-accenture-hackathon-virt.vercel.app

If you deploy elsewhere, update `VITE_API_URL` and `CORS_ORIGINS` accordingly.

## What I built (high-level)
- IDP Agent: A data-first agent that parses free-form facility text, normalizes capabilities into the canonical schema, and reasons about missing or conflicting claims.
- RAG + Retrieval: Facility records and extracted passages are embedded and indexed (Databricks embeddings when available; FAISS fallback included) to power accurate retrieval for the agent.
- FastAPI Backend: REST endpoints and SSE streams for agent interactions, search, region/summary metrics, and health checks.
- React + Vite Frontend: Interactive dashboard with mapping, charts, natural-language agent chat, and CSV/FAISS fallbacks for offline demo.

## Core features (MVP)
1. Unstructured Feature Extraction — parse free-form fields and extract structured capabilities (procedures, equipment, services).
2. Intelligent Synthesis — combine extracted facts with structured facility schema and Databricks tables to build regional capability profiles.
3. Planning & Agent Workflows — natural language agent that can propose plans, assign specialists, and provide step-level citations.

## Stretch features implemented
- Row-level citations: each claim returned by the agent includes source passages and row identifiers where available.
- Map visualization: choropleth and point-maps show medical desert scores and facility coverage.
- FAISS fallback: precomputed local FAISS index and metadata for offline demos and to avoid Databricks dependency in small-scale demos.

## Architecture
- Frontend: Vite + React (TypeScript), built to `dist` and deployed to Vercel.
- Backend: FastAPI (uvicorn) providing API endpoints, IDP agent orchestration, and health checks.
- Retrieval: Databricks SQL + vector/serving endpoints (when credentials provided) or a local FAISS index fallback.
- Optional Redis (Upstash) for chat history and rate limiting.

Project layout
- `backend/` — FastAPI app, Dockerfile, rag_data fallback, and deployment blueprint.
- `frontend/` — Vite React SPA for dashboard + agent UI.
- `databricks/` — notebooks, transforms, and exported CSVs used to build gold tables.

## Quickstart — local development
Backend
```bash
cd backend
cp .env.example .env
python -m venv .venv
source .venv/bin/activate  # Windows: .\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

## Environment variables (important)
- `DATABRICKS_HOST` — Databricks workspace host
- `DATABRICKS_TOKEN` — Databricks PAT (rotate if leaked)
- `DATABRICKS_HTTP_PATH` or `DATABRICKS_SQL_WAREHOUSE_ID`
- `DATABRICKS_CATALOG` / `DATABRICKS_SCHEMA`
- `LLM_ENDPOINT` / `EMBED_ENDPOINT` — optional Databricks serving endpoints
- `MLFLOW_TRACKING_URI` — set to `databricks` when using MLflow tracking
- `SECRET_KEY` — app secret
- `CORS_ORIGINS` — comma-separated origins for browser clients (Vercel + local dev)
- `FAISS_INDEX_URL` / `FAISS_META_URL` — optional URLs to fetch FAISS artifacts at build time

Security note: remove any real tokens from committed `.env` files and rotate compromised tokens immediately.

## Deployment (split, free tiers)
1. Deploy backend to Render (use `backend/Dockerfile` and `backend/render.yaml`). Set environment variables in the Render service (including `CORS_ORIGINS` and Databricks secrets).
2. Deploy frontend to Vercel with Root Directory `frontend`, Build Command `npm run build`, Output `dist`, and Environment Variable `VITE_API_URL` set to your Render URL.
3. Update `CORS_ORIGINS` on Render to include your Vercel domain and localhost origins used for development.

## Verification & endpoints
- `GET /health` — returns Databricks and FAISS status + SQL health check.
- `GET /api/v1/regions/summary` — region-level summary metrics.
- `POST /api/v1/agent/query` — send natural-language queries to the IDP agent (SSE streaming supported for stepwise responses).

## How this maps to the hackathon evaluation
- Technical accuracy: Databricks SQL + RAG retrieval with confidence metrics and queries verified by row-level citations.
- IDP innovation: extraction pipeline normalizes messy free-text into validated capabilities and equipment records.
- Social impact: visual maps and desert scores make resource allocation decisions actionable for NGOs.
- UX: simple chat and dashboard intended for non-technical planners.

## Next steps & notes
- Improve agent traceability with MLflow trace links for each agent sub-step (stretch goal).
- Add automated tests for extraction accuracy and end-to-end SSE streams.

## Contributing
PRs welcome. Please file issues for bugs or feature requests.

---
If you'd like, I can also add a short `SHOWCASE.md` with screenshots and example queries to highlight the agent flows on the repo front page.


