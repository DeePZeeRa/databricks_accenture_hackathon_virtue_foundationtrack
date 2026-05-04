# Virtue Foundation Ghana Healthcare Intelligence Platform

Full-stack demo layer for the Databricks Virtue FoundationTrack pipeline. The app exposes a FastAPI backend over Unity Catalog gold tables, FAISS semantic search, anomaly outputs, and medical desert scores, with a Vite React frontend for NGO planning workflows.

## Architecture

- `databricks/`: executed notebooks and exported artifacts.
- `backend/app/`: canonical FastAPI API.
- `backend/rag_data/`: FAISS fallback index and metadata for split Vercel backend deployment.
- `backend/data/`: compact CSV fallback exports for anomaly, regional, and desert views.
- `frontend/`: Vite React dashboard deployed as a separate Vercel static project.

The backend runs in **live + fallback** mode. If Databricks SQL and serving endpoint secrets are present, API routes use Unity Catalog and model serving. If those secrets are absent or Databricks is unavailable, static dashboard routes use bundled FAISS metadata and CSV exports so demo pages still load.

## Local Development

Backend:

```bash
cd backend
copy .env.example .env
uvicorn main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Required Backend Environment

Set these in `backend/.env` locally and in the backend Vercel project settings for live mode:

- `DATABRICKS_HOST`
- `DATABRICKS_TOKEN`
- `DATABRICKS_SQL_WAREHOUSE_ID`
- `DATABRICKS_CLUSTER_ID`
- `DATABRICKS_CATALOG=virtue_foundation`
- `DATABRICKS_SCHEMA=ghana`
- `EMBED_ENDPOINT`
- `LLM_ENDPOINT`
- `MLFLOW_TRACKING_URI`
- `SECRET_KEY`
- `CORS_ORIGINS`
- `REDIS_URL` optional, Upstash Redis recommended for rate limiting and history

Rotate any Databricks token that was previously committed or copied into an example file.

## Split Vercel Deployment

Backend project:

- Root directory: `backend`
- Framework: Other / Python
- Build command: default
- Output directory: default
- Entry function: `api/index.py`
- Add all backend env vars above.

Frontend project:

- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
- Env: `VITE_API_BASE_URL=https://<backend-project>.vercel.app`
- Optional env: `VITE_API_KEY=<matching backend API key>`

After deploying the frontend URL, update backend `CORS_ORIGINS` to include that Vercel URL and redeploy the backend.

## Verification

- `GET /health` reports Databricks, cache, and FAISS status.
- Dashboard renders total facilities, anomaly counts, desert region counts, and RAG-ready count.
- Map renders geocoded facilities and excludes the Ghana centroid fallback.
- Facilities search works with live embeddings when configured and lexical fallback when not.
- Agent streaming emits SSE chunks ending in `done`; full fidelity requires live Databricks LLM endpoints.


