# Virtue Foundation — Ghana Healthcare Intelligence

![Virtue Foundation Ghana Healthcare Intelligence](./frontend/public/assets/cover_demo.png)

> **Bridging Medical Deserts with AI, Databricks, and Agentic Intelligence**

A next-generation healthcare intelligence platform that identifies "medical deserts" and connects clinical expertise to the places that need it most. Built for the Databricks + Accenture Virtue FoundationTrack hackathon, this project demonstrates an Intelligent Document Parsing (IDP) agent, RAG pipeline, and interactive dashboard for NGO planners, clinicians, and data scientists.

---

## 🚀 What I Built

This project is a full-stack, agentic healthcare intelligence platform designed to:

- **Parse and normalize messy, unstructured facility data** using an Intelligent Document Parsing (IDP) agent.
- **Detect medical deserts** by analyzing regional gaps in clinical capabilities, equipment, and staffing.
- **Visualize healthcare access** with interactive maps, desert heat overlays, and facility-level popups.
- **Enable natural-language planning and audit** via an agent chat interface, supporting row-level citations for every claim.
- **Support both Databricks and offline/FAISS modes** for flexible, robust retrieval and analytics.
- **Empower NGOs, planners, and clinicians** to make data-driven decisions for resource allocation, intervention, and impact measurement.

## 💡 How This Project Helps

- **For NGOs and Planners:**
	- Instantly identify underserved regions and prioritize interventions.
	- Audit facility claims and spot anomalies or data inconsistencies.
	- Plan deployments and investments with confidence, using region-level scores and facility details.
- **For Data Scientists and Engineers:**
	- Demonstrates scalable RAG and agentic workflows on real-world, messy data.
	- Provides a blueprint for integrating Databricks, FAISS, and modern frontend frameworks.
- **For Hackathon and Open Source:**
	- Showcases best practices in full-stack AI, retrieval, and agent orchestration.
	- Offers a ready-to-demo, extensible platform for healthcare analytics and beyond.

---


## 🛠️ Tech Stack & Full Workflow

### Technologies Used

- **Frontend:**
	- React (TypeScript, Vite)
	- React-Leaflet & Leaflet (interactive maps)
	- CSS Modules, custom theming
	- Vercel (hosting)
- **Backend:**
	- FastAPI (Python)
	- Uvicorn (ASGI server)
	- Structlog (structured logging)
	- CORS, SSE (Server-Sent Events)
	- Docker (containerization)
- **Retrieval & Data:**
	- Databricks SQL Warehouse (primary data source)
	- Databricks Vector Search (semantic retrieval)
	- FAISS (local fallback for embeddings & search)
	- Pandas, Numpy (data processing)
	- Redis/Upstash (optional caching)
- **Agent & AI:**
	- Intelligent Document Parsing (IDP) agent (custom, Python)
	- RAG (Retrieval-Augmented Generation) pipeline
	- LangGraph (agent orchestration)
	- MLflow (optional, for traceability)
- **Data Engineering:**
	- Databricks Notebooks (ETL, anomaly detection, scoring)
	- CSV, GeoJSON, and gold/silver/bronze data tables

### End-to-End Workflow

1. **Data Ingestion & Processing**
	 - Raw facility data (CSV, free-text, geo) is ingested and cleaned in Databricks notebooks.
	 - ETL pipelines produce "bronze" (raw), "silver" (cleaned), and "gold" (enriched, scored) tables.
	 - Anomaly detection and medical desert scoring are performed in Databricks, with outputs exported as CSV and GeoJSON.

2. **Indexing & Retrieval**
	 - Facility records and extracted passages are embedded using Databricks or local FAISS.
	 - Vector indexes are built for fast semantic search and retrieval.
	 - Metadata and index files are stored locally or fetched from remote URLs.

3. **Backend API & Agent**
	 - FastAPI serves REST endpoints for health, region summaries, facility details, and agent queries.
	 - The IDP agent parses, normalizes, and reasons over messy facility text, using RAG to ground answers in retrieved evidence.
	 - SSE endpoints stream agent responses step-by-step to the frontend.

4. **Frontend Dashboard**
	 - React app displays interactive maps (desert heat, facility markers), charts, and agent chat.
	 - Users can filter, search, and click on facilities for detailed popups.
	 - Agent chat supports natural-language queries, returning answers with citations and recommended actions.

5. **Deployment & Operations**
	 - Frontend is deployed to Vercel; backend can be run locally, in Docker, or on cloud VMs.
	 - Environment variables control Databricks, FAISS, and Redis integration.
	 - Health endpoints and logs provide operational visibility.


---

## 🚀 Live Demo
- **Frontend (Vercel):** [virtue-foundation-ghana-dd.vercel.app](https://virtue-foundation-ghana-dd.vercel.app)

> _Note: Initial startup may take up to 2 minutes due to cold starts. Refresh after first load for optimal performance._

---

## 🏆 Key Outcomes
- **Extract** structured medical capability facts from unstructured facility text (procedures, equipment, capabilities).
- **Detect** gaps and anomalous claims about services (anomaly detection + rule checks).
- **Score** and visualize region-level medical desert scores to guide investments and deployments.
- **Agentic Planner:** Natural-language agent interface with row-level citations for traceability.

---

## 🖼️ Screenshots

| Map Explorer (Desert Heat) | Facility Detail Popup | Agent Chat (RAG) |
|---------------------------|----------------------|------------------|
| ![Map Explorer](./frontend/public/assets/screenshot_map.png) | ![Facility Popup](./frontend/public/assets/screenshot_popup.png) | ![Agent Chat](./frontend/public/assets/screenshot_agent.png) |

---

## 🏗️ Architecture

- **Frontend:** Vite + React (TypeScript), deployed to Vercel. Interactive dashboard, map explorer, agent chat, and analytics.
- **Backend:** FastAPI (uvicorn) with REST endpoints, SSE streaming, IDP agent orchestration, and health checks.
- **Retrieval:** Databricks SQL + vector search (when credentials provided) or local FAISS index fallback.
- **Optional:** Redis (Upstash) for chat history and rate limiting.

```
frontend/   # React SPA, Vite, map & agent UI
backend/    # FastAPI app, Dockerfile, rag_data fallback
						# SSE, agent, health, and analytics endpoints
						# Databricks/FAISS/Redis integration
```

---

## ✨ Core Features

1. **Unstructured Feature Extraction** — Parse free-form fields and extract structured capabilities (procedures, equipment, services).
2. **Intelligent Synthesis** — Combine extracted facts with structured facility schema and Databricks tables to build regional capability profiles.
3. **Planning & Agent Workflows** — Natural language agent that can propose plans, assign specialists, and provide step-level citations.
4. **Row-level Citations** — Each claim returned by the agent includes source passages and row identifiers.
5. **Map Visualization** — Choropleth and point-maps show medical desert scores and facility coverage.
6. **FAISS Fallback** — Precomputed local FAISS index and metadata for offline demos and to avoid Databricks dependency in small-scale demos.

---

## 🛠️ Quickstart — Local Development

### Backend
```bash
cd backend
cp .env.example .env
python -m venv .venv
source .venv/bin/activate  # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## ⚙️ Environment Variables

- `DATABRICKS_HOST` — Databricks workspace host
- `DATABRICKS_TOKEN` — Databricks PAT (rotate if leaked)
- `DATABRICKS_HTTP_PATH` or `DATABRICKS_SQL_WAREHOUSE_ID`
- `DATABRICKS_CATALOG` / `DATABRICKS_SCHEMA`
- `LLM_ENDPOINT` / `EMBED_ENDPOINT` — optional Databricks serving endpoints
- `MLFLOW_TRACKING_URI` — set to `databricks` when using MLflow tracking
- `SECRET_KEY` — app secret
- `CORS_ORIGINS` — comma-separated origins for browser clients (Vercel + local dev)
- `FAISS_INDEX_URL` / `FAISS_META_URL` — optional URLs to fetch FAISS artifacts at build time

> **Security note:** Remove any real tokens from committed `.env` files and rotate compromised tokens immediately.

---

## 🩺 API Endpoints

- `GET /health` — Returns Databricks and FAISS status + SQL health check.
- `GET /api/v1/regions/summary` — Region-level summary metrics.
- `POST /api/v1/agent/query` — Send natural-language queries to the IDP agent (SSE streaming supported for stepwise responses).

---

## 🧠 How This Maps to the Hackathon Evaluation

- **Technical accuracy:** Databricks SQL + RAG retrieval with confidence metrics and queries verified by row-level citations.
- **IDP innovation:** Extraction pipeline normalizes messy free-text into validated capabilities and equipment records.
- **Social impact:** Visual maps and desert scores make resource allocation decisions actionable for NGOs.
- **UX:** Simple chat and dashboard intended for non-technical planners.

---

## 📝 Next Steps & Roadmap
- Improve agent traceability with MLflow trace links for each agent sub-step (stretch goal).
- Add automated tests for extraction accuracy and end-to-end SSE streams.
- Expand map overlays and analytics for deeper regional insights.

---

## 🤝 Acknowledgements
- **Virtue Foundation** — for the vision and data
- **Databricks & Accenture** — for the hackathon platform
- **Open Source** — React, FastAPI, Leaflet, FAISS, and more

---

## 📂 Project Structure

```
backend/
	app/           # FastAPI app, agents, core, models, services
	rag_data/      # FAISS fallback index and metadata
	static/        # Static assets for backend serving
	tests/         # Backend tests
frontend/
	src/           # React app source (pages, api, components)
	public/        # Static assets (screenshots, icons)

	notebooks/     # Data engineering, ETL, and scoring pipelines
```

---


## 🛡️ Security & Best Practices
- Never commit secrets or real tokens to the repo.
- Use platform secret management for production deployments.
- Rotate credentials if exposed.


