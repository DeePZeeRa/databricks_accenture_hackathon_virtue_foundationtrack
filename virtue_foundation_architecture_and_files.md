# Virtue Foundation Ghana Healthcare Intelligence Platform: Architecture & Component Guide

This document provides a highly detailed, comprehensive explanation of the architecture, data flow, and file-level functionalities for the Virtue Foundation Ghana Healthcare Intelligence Platform. This platform was developed for the **Databricks Accenture Hackathon**, aiming to solve critical healthcare infrastructure challenges in Ghana, such as mapping "Medical Deserts" and identifying infrastructure anomalies (e.g., clinics with an X-Ray machine but no electricity).

> [!NOTE]
> **Project Context:** The Virtue Foundation provides healthcare services to underserved areas globally. The core challenge tackled here is unifying messy, unstructured data (PDFs, raw text, CSVs) from NGOs and government sources into a structured **Unity Catalog** on Databricks. This data is then surfaced via an interactive React frontend and an AI-powered agent to help NGO workers make data-driven decisions on where to allocate medical resources.

---

## 1. Project Overview & The Challenge

The challenge requires participants to build a data pipeline and intelligence layer that ingests multi-modal data. 
Key objectives include:
- **Data Ingestion & Transformation:** Convert unstructured data (like free-form text about medical facilities and PDF reports) into structured "Bronze, Silver, and Gold" tables using Databricks **AI Functions** (`ai_extract`, `ai_query`).
- **Medical Desert Scoring (MDS):** Calculate a composite score for regions based on infrastructure density, specialized staff, and population, identifying critical coverage gaps.
- **Anomaly Detection:** Flag impossible or highly unlikely scenarios (e.g., a hospital reporting 500 surgeons but 0 hospital beds, or a clinic missing a physical address).
- **Interactive AI Agent:** Provide a conversational interface backed by Databricks Vector Search (RAG) and Databricks SQL to allow stakeholders to query the data naturally (e.g., *"Which region needs a pediatric surgeon the most?"*).

---

## 2. The `@databricks` Directory: Data Engineering & ML

The `databricks/notebooks/` directory contains the core ELT (Extract, Load, Transform) pipelines and AI logic. This follows the Databricks Medallion Architecture.

### Data Pipelines (Medallion Architecture)

#### Bronze & Silver (Ingestion & Cleaning)
- **`01_ingest_bronze_v2.ipynb`**: The entry point for the data pipeline. It ingests raw CSVs, GeoJSON files, and unstructured text into Unity Catalog as `bronze_facilities_raw`.
- **`02_transform_silver.py` / `.ipynb`**: This is where the heavy lifting of data cleaning happens. It drops duplicates, standardizes column names, and parses messy address fields to create `silver_facilities_cleaned`.

#### Gold & Analytics (Business Logic & Anomalies)
- **`03_build_gold.py`**: Aggregates the silver data into business-ready tables. It joins facility data with regional geometries to create `gold_facilities_enriched`.
- **`07_medical_desert_scoring.py`**: A critical file that implements the **Medical Desert Score (MDS)** algorithm. It calculates metrics based on bed-to-population ratios, doctor availability, and infrastructure readiness, outputting to `gold_medical_desert_scores`.
- **`08_anomaly_detection.py`**: Runs rule-based and AI-assisted checks to find data anomalies (e.g., logical inconsistencies in reported medical staff vs. equipment). Outputs to `gold_anomaly_report`.

### AI & Agents (Data Extraction & RAG)
- **`04_idp_agent.py`**: Uses Intelligent Document Processing (IDP). It leverages Databricks Foundation Models (like `Llama-3`) to extract structured data (e.g., number of doctors, facility capabilities) from unstructured text using prompt engineering.
- **`05_rag_build_index.py`**: Takes the processed text and metadata, generates vector embeddings, and synchronizes them with a **Databricks Vector Search Index**. This prepares the data for semantic search.
- **`06_langgraph_agent.py`**: A prototyping notebook used to build the LangGraph orchestration flow before it was ported to the FastAPI backend. It defines how the AI agent routes queries between SQL generation and Vector Search.

> [!TIP]
> **Example Workflow:** A raw PDF report from an NGO is ingested by `01_ingest_bronze`. `04_idp_agent` uses `ai_extract()` to pull out the fact that the facility has 2 pediatricians. `07_medical_desert_scoring` recalculates the MDS for that region, lowering its "Desert" severity. The dashboard immediately reflects this new score.

---

## 3. The `@[backend]` Directory: FastAPI & AI Orchestration

The `backend/app/` directory houses the FastAPI application. It acts as the bridge between the React frontend and Databricks. It operates in a **Live + Fallback** mode: if Databricks is unreachable, it gracefully degrades to using local FAISS indexes and CSVs.

### `api/` (API Routers & Endpoints)
- **`api/agent.py`**: The endpoint for the chat interface (`POST /api/v1/agent/query`). It handles Server-Sent Events (SSE) to stream tokens back to the frontend for a real-time typing effect.
- **`api/facilities.py` & `api/regions.py`**: Serve structured data to the frontend map and dashboard. `regions.py` serves the Medical Desert Scores, while `facilities.py` provides the geocoded coordinates for the Leaflet map.
- **`api/anomalies.py`**: Exposes the data quality flags generated by the Databricks pipeline, allowing the frontend to highlight unreliable data points.

### `services/` (Core Integrations)
- **`services/sql_service.py`**: Manages the connection to the Databricks SQL Warehouse using the `databricks-sql-connector`. It provides async-safe query execution for the agent and dashboard.
- **`services/faiss_service.py`**: The fallback vector database. If the Databricks Vector Search endpoint is offline, this service loads a local `.faiss` index from `backend/rag_data/` to ensure the app continues functioning.
- **`services/cache_service.py`**: Implements Redis caching to prevent redundant Databricks SQL queries, significantly speeding up dashboard load times.

### `agents/` (LangGraph AI Orchestrator)
- **`agents/graph.py`**: Compiles the LangGraph state machine. It defines the flow of the agent.
- **`agents/nodes.py`**: Contains the individual functions (nodes) of the graph:
  - `router_node`: Decides if a user query requires a SQL database query, a semantic vector search, or general conversation.
  - `sql_node`: Generates and executes Databricks SQL queries to answer analytical questions.
  - `medical_node`: Uses Vector Search to answer questions based on the ingested PDF documents.
- **`agents/prompts.py`**: Contains the highly-tuned system prompts that instruct the LLM on how to behave like a Virtue Foundation healthcare analyst.

> [!IMPORTANT]
> **Why LangGraph?** LangGraph allows the backend to create an agent with *memory* and *conditional logic*. If a user asks "Which region has the fewest beds?", the agent routes to the `sql_node`. If the user follows up with "Tell me more about the clinics there based on the NGO reports", the agent routes to the RAG/Vector node while remembering the region from the previous turn.

---

## 4. The `@[frontend]` Directory: React & Vite Dashboard

The `frontend/src/` directory contains a modern, responsive React application built with TypeScript and Vite. It is designed for NGO workers to visualize the data engineered in Databricks.

### Core Configuration & Styling
- **`main.tsx` & `App.tsx`**: The entry points of the React application. `App.tsx` handles the client-side routing (e.g., switching between the Map view, the Anomaly view, and the Agent view).
- **`index.css` & `index_v2.css`**: Contain the comprehensive design system. The project uses advanced CSS for a "Premium" aesthetic, featuring glassmorphism, dynamic hover states, and responsive grids.

### `pages/` (Application Views)
- **`pages/Dashboard.tsx`**: The primary view. It fetches data from the FastAPI backend and renders high-level KPIs (Total Facilities, Critical Deserts). It heavily utilizes the `api/client.ts` to sync data.

### `api/` (Client Networking)
- **`api/client.ts`**: The unified networking layer. This file contains all the `fetch` wrappers required to communicate with the FastAPI backend. 
  - *Example:* The `getDesertScores()` function calls `GET /api/v1/regions/desert-scores` and returns typed TypeScript interfaces (`DesertScore[]`).
  - It also handles the complex logic for consuming the Server-Sent Events (SSE) stream emitted by the `api/agent.py` endpoint for the chat interface.

### The Interactive Map (Components)
While component files might be abstracted within `pages/`, the frontend fundamentally relies on `Leaflet.js` to render the `ghana_facilities.geojson` data.
- **Medical Desert Visualization:** The frontend consumes the Medical Desert Scores from the backend and applies a color gradient (Heatmap) to the regions of Ghana. Red regions indicate critical medical deserts (high population, low resources), visually guiding stakeholders on where to deploy interventions.

> [!TIP]
> **Frontend Integration Example:** When a user selects a region on the Leaflet Map, the frontend calls the `client.ts` function to fetch that specific region's anomalies. It then displays a UI alert warning the user if the data for that region has a high "Continuity Risk" (e.g., missing critical infrastructure data), ensuring decision-makers are aware of data quality issues.
