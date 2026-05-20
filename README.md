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

## Deployment

The project is ready for a free split deployment:

- Frontend: Vercel static hosting from the `frontend` folder
- Backend: Render free web service from the `backend` folder

Use the step-by-step guide in [DEPLOYMENT.md](DEPLOYMENT.md) for the exact sequence, required environment variables, and verification checks.

### Quick summary

1. Deploy the backend first on Render and copy the public URL.
2. Deploy the frontend on Vercel with `VITE_API_URL` set to that Render URL.
3. Update `CORS_ORIGINS` in Render to include your Vercel domain.

## Verification

- `GET /health` reports Databricks, cache, and FAISS status.
- Dashboard renders total facilities, anomaly counts, desert region counts, and RAG-ready count.
- Map renders geocoded facilities and excludes the Ghana centroid fallback.
- Facilities search works with live embeddings when configured and lexical fallback when not.
- Agent streaming emits SSE chunks ending in `done`; full fidelity requires live Databricks LLM endpoints.


