# 🏥 Bridging Medical Deserts: IDP Agent for Virtue Foundation

**Track:** Databricks Challenge  
**Team:** Healthcare Intelligence for Ghana  
**Goal:** Build an Intelligent Document Parsing (IDP) agentic system to reduce patient wait times by 100× through AI-powered healthcare coordination

---

## 🎯 Executive Summary

This project addresses a critical global healthcare challenge: **10 million healthcare worker shortage by 2030**. The solution is an AI-powered Intelligent Document Parsing (IDP) system that analyzes Ghana's healthcare infrastructure to:

✅ **Identify medical deserts** with Critical/High severity classifications  
✅ **Map facility capabilities** across 987 healthcare facilities  
✅ **Enable semantic search** over unstructured medical data  
✅ **Guide resource allocation** for volunteer doctors and equipment  
✅ **Provide actionable insights** through natural language queries

### Key Results
- **Data Processed:** 987 facilities across Ghana
- **Intelligence Fields:** 6 computed capability metrics (emergency, surgery, imaging, scoring)
- **Agent Tools:** 4 Unity Catalog tools with row-level citations
- **Vector Search:** Semantic search over 987 facility records
- **API Endpoints:** 5 production-ready REST endpoints

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      DATA PIPELINE (Medallion)                  │
└─────────────────────────────────────────────────────────────────┘

   CSV (987 rows)
      ↓
┌──────────────┐
│ 01. BRONZE   │  Raw ingestion from Virtue Foundation dataset
│  (ingest)    │  Table: vf_health.ghana.bronze_raw_facilities
└──────┬───────┘
       ↓
┌──────────────┐
│ 02. SILVER   │  Cleaning + Intelligence Fields:
│ (transform)  │  • has_emergency, has_surgery, has_imaging
└──────┬───────┘  • capability_score (0-8 pts)
       ↓          • is_medical_desert_risk
┌──────────────┐  • address_region_clean
│ 03. GOLD     │  Two tables:
│  (aggregate) │  • gold_region_summary (regional gaps)
└──────┬───────┘  • gold_facility_cards (RAG-ready)
       ↓
┌──────────────┐
│ 04. VECTOR   │  Databricks Vector Search Index
│    INDEX     │  • Embedding: databricks-gte-large-en
└──────┬───────┘  • Source: full_text_for_rag column
       ↓
┌─────────────────────────────────────────────────────────────────┐
│                    AGENTIC INTELLIGENCE LAYER                   │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐
│ 05. AGENT    │  LangChain ReAct Agent:
│  (LangChain) │  • LLM: databricks-meta-llama-3-3-70b-instruct
└──────┬───────┘  • 4 Tools with citations
       ↓          • MLflow tracking
┌──────────────┐
│ FASTAPI      │  REST API (5 endpoints):
│   BACKEND    │  • /api/regions
└──────┬───────┘  • /api/facilities
       ↓          • /api/medical-deserts
┌──────────────┐  • /api/agent/query
│  FRONTEND    │  • /api/stats/summary
│ (React/TS)   │
└──────────────┘  [Frontend placeholder - see Future Work]

┌─────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATION & CI/CD                      │
└─────────────────────────────────────────────────────────────────┘

06. Lakeflow Job (4 tasks, daily at 02:00 UTC)
07. Agent Evaluation (MLflow metrics)
Deployment: Render (backend) + GitHub Actions
```

---

## 📊 Medical Deserts Identified

### Severity Classification System

**Capability Score (0-8 points):**
- Emergency care: 2 pts
- Surgical services: 2 pts
- Medical imaging: 1 pt
- 5+ doctors: 2 pts
- 20+ beds: 1 pt

**Gap Severity Levels:**
- **Critical:** >60% facilities at risk OR avg score <2
- **High:** >40% facilities at risk OR avg score <3
- **Moderate:** >20% facilities at risk
- **Low:** <20% facilities at risk

### Key Findings (Run notebooks to see actual data)

*After running the pipeline, this section will contain:*
- Number of Critical severity regions
- Number of High severity regions
- Regions with lowest capability scores
- Facilities at medical desert risk percentage
- Total doctors and beds by region

**Example queries to explore:**
```sql
SELECT * FROM vf_health.ghana.gold_region_summary 
WHERE gap_severity IN ('Critical', 'High')
ORDER BY desert_pct DESC;
```

---

## 🚀 Quick Start

### Prerequisites

- Databricks Workspace (Free Edition compatible)
- Python 3.11+
- Git

### 1. Setup Databricks Environment

**Create Catalog and Schema:**
```sql
CREATE CATALOG IF NOT EXISTS vf_health;
CREATE SCHEMA IF NOT EXISTS vf_health.ghana;
```

**Upload Dataset:**
1. Download: [Virtue Foundation Ghana Dataset v0.3](https://github.com/virtue-foundation/vf-health-data)
2. Upload to: `/Volumes/vf_health/ghana/raw/`

### 2. Run the Data Pipeline

**Execute notebooks in order:**

```bash
1. databricks/notebooks/01_ingest_bronze.ipynb
2. databricks/notebooks/02_transform_silver.ipynb
3. databricks/notebooks/03_build_gold.ipynb
4. databricks/notebooks/04_build_vector_index.ipynb
5. databricks/notebooks/05_build_agent.ipynb
```

**Or use the orchestration job:**
```bash
6. databricks/notebooks/06_orchestration_job.ipynb
```

This creates a Databricks Workflow that runs all 4 tasks daily at 02:00 UTC.

### 3. Deploy Backend API

**Local Development:**
```bash
cd backend
cp .env.example .env
# Edit .env with your Databricks credentials
pip install -r requirements.txt
uvicorn main:app --reload
```

API will be available at: `http://localhost:8000`

**Production Deployment (Render.com):**
1. Push code to GitHub
2. Connect Render to your repository
3. Set environment variables in Render dashboard:
   - `DATABRICKS_HOST`
   - `DATABRICKS_TOKEN`
   - `DATABRICKS_WAREHOUSE_ID`
4. Deploy automatically via `render.yaml`

---

## 🛠️ Technical Stack

### Data Pipeline
- **Storage:** Delta Lake (Unity Catalog)
- **Processing:** PySpark
- **Orchestration:** Databricks Workflows (Lakeflow)

### AI/ML
- **Vector Search:** Databricks Vector Search (databricks-gte-large-en)
- **LLM:** databricks-meta-llama-3-3-70b-instruct
- **Agent Framework:** LangChain (ReAct pattern)
- **Experiment Tracking:** MLflow

### Backend
- **Framework:** FastAPI
- **Database Connector:** databricks-sql-connector
- **Deployment:** Render.com (free tier)

### Frontend (Placeholder)
- **Framework:** React + TypeScript + Vite
- **Styling:** Tailwind CSS
- **Charts:** Recharts
- **Maps:** React-Leaflet
- **Deployment:** Vercel

---

## 📁 Project Structure

```
vf-health-ghana-idp/
├── databricks/
│   ├── notebooks/
│   │   ├── 01_ingest_bronze.ipynb          # Bronze layer ingestion
│   │   ├── 02_transform_silver.ipynb       # Silver with intelligence
│   │   ├── 03_build_gold.ipynb             # Gold aggregations
│   │   ├── 04_build_vector_index.ipynb     # Vector search setup
│   │   ├── 05_build_agent.ipynb            # LangChain agent
│   │   ├── 06_orchestration_job.ipynb      # Lakeflow job
│   │   └── 07_agent_evaluation.ipynb       # MLflow evaluation
│   └── prompts_and_pydantic_models/        # Data models
│       ├── organization_extraction.py
│       ├── medical_specialties.py
│       ├── free_form.py
│       └── facility_and_ngo_fields.py
├── backend/
│   ├── main.py                             # FastAPI app
│   ├── agent_module.py                     # Agent singleton
│   ├── requirements.txt                    # Python deps
│   ├── .env.example                        # Env template
│   └── Procfile                            # Render config
├── frontend/                               # [Placeholder - see Future Work]
├── render.yaml                             # Backend deployment
└── README.md                               # This file
```

---

## 🔌 API Endpoints

### Base URL
- **Local:** `http://localhost:8000`
- **Production:** `https://your-app.onrender.com`

### Endpoints

#### 1. GET `/api/regions`
Get all regions with medical infrastructure metrics.

**Response:**
```json
{
  "count": 45,
  "regions": [
    {
      "region": "Greater Accra",
      "total_facilities": 125,
      "avg_capability_score": 3.8,
      "desert_pct": 15.2,
      "gap_severity": "Moderate",
      "citation": { ... }
    }
  ]
}
```

#### 2. GET `/api/facilities`
Search facilities with filters.

**Query Parameters:**
- `region` (optional): Filter by region
- `has_emergency` (optional): Filter by emergency capability
- `has_surgery` (optional): Filter by surgical capability
- `min_score` (optional): Minimum capability score
- `limit` (optional): Max results (default: 50)

#### 3. GET `/api/medical-deserts`
Get Critical/High severity regions with at-risk facilities.

#### 4. POST `/api/agent/query`
Natural language query to the IDP agent.

**Request:**
```json
{
  "query": "Which regions need volunteer doctors most urgently?"
}
```

**Response:**
```json
{
  "answer": "Based on the analysis...",
  "citations": [...],
  "tools_used": ["find_medical_deserts", "get_region_gap_analysis"],
  "execution_time_ms": 2547
}
```

#### 5. GET `/api/stats/summary`
National-level summary statistics.

---

## 🧪 Testing the Agent

### Sample Queries

```python
import requests

BASE_URL = "http://localhost:8000"

# Query 1: Medical Deserts
response = requests.post(f"{BASE_URL}/api/agent/query", json={
    "query": "Which regions in Ghana have the most critical medical deserts?"
})
print(response.json()["answer"])

# Query 2: Facility Search
response = requests.post(f"{BASE_URL}/api/agent/query", json={
    "query": "Find all facilities with emergency care and surgery in Greater Accra"
})
print(response.json()["answer"])

# Query 3: Resource Allocation
response = requests.post(f"{BASE_URL}/api/agent/query", json={
    "query": "Where should volunteer doctors be prioritized?"
})
print(response.json()["answer"])
```

---

## 📈 MLflow Experiments

Track agent performance:

1. **Experiment:** `/vf_health/idp_agent_experiment`
   - Query execution traces
   - Tool usage metrics
   - Response quality

2. **Experiment:** `/vf_health/idp_agent_evaluation`
   - Evaluation dataset (10 Q&A pairs)
   - Faithfulness, correctness, relevance metrics

Access MLflow UI in Databricks workspace: `Machine Learning` → `Experiments`

---

## 🎓 Key Features & Innovation

### 1. Intelligent Document Parsing (IDP)
- Extracts structure from free-text medical data
- Standardizes 100+ medical terms across 4 categories
- Handles multilingual and messy data

### 2. Computed Intelligence Fields
- `capability_score`: 0-8 point quantitative assessment
- `has_emergency`, `has_surgery`, `has_imaging`: Boolean capability flags
- `is_medical_desert_risk`: Automatic risk classification
- `address_region_clean`: Normalized geographic data

### 3. Citations & Traceability
- **Row-level citations:** Every data point includes source table and facility name
- **Step-level tracing:** MLflow logs each agent reasoning step
- **Audit trail:** Full lineage from CSV → Bronze → Silver → Gold → Vector → Agent

### 4. Agentic Reasoning
- **4 specialized tools:** search_facilities, get_region_gap_analysis, find_medical_deserts, get_facility_detail
- **ReAct pattern:** Thought → Action → Observation loop
- **Context-aware:** Agent understands Ghana healthcare context

---

## 🚧 Future Work

### Frontend Development
The backend API is production-ready. A full frontend requires:

**Pages:**
1. **Dashboard** - Overview cards, regional charts (Recharts)
2. **Medical Deserts Map** - Interactive map with facility markers (Leaflet)
3. **Facility Explorer** - Searchable table with filters
4. **AI Agent Chat** - Conversational interface for queries
5. **Region Deep-Dive** - Detailed regional analysis

**Tech Stack:**
- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui components
- React Query for data fetching
- Recharts for visualizations
- React-Leaflet for mapping

**Deployment:**
- Vercel (free tier)
- Environment variables for API URL

### Enhancements
- **Authentication:** JWT-based user authentication
- **Caching:** Redis for faster API responses
- **Real-time updates:** WebSockets for live agent responses
- **Mobile app:** React Native for field workers
- **Multilingual support:** Translations for local languages

---

## 🏆 Evaluation Criteria Alignment

### Technical Accuracy (35%)
✅ **Reliable handling of "Must Have" queries**
- 4 specialized tools cover all core queries
- Citations prevent hallucination
- MLflow tracking for quality assurance

✅ **Anomaly detection in facility data**
- Validation rules catch invalid data
- Capability scoring identifies suspicious claims
- Medical desert risk flags low-quality facilities

### IDP Innovation (30%)
✅ **Extraction from unstructured text**
- Free-form medical terminology normalization
- Array parsing for semicolon-separated values
- Regex-based capability detection

✅ **Synthesis of structured + unstructured data**
- Combines facility metadata with free-text capabilities
- Creates `full_text_for_rag` column for vector search
- Intelligent scoring from multiple data sources

### Social Impact (25%)
✅ **Identifies medical deserts**
- 4-level severity classification (Critical/High/Moderate/Low)
- Regional gap analysis with actionable metrics
- Facility-level risk assessment

✅ **Aids resource allocation**
- Agent recommends where to send volunteers
- Identifies equipment gaps
- Prioritizes regions by severity

### User Experience (10%)
✅ **Intuitive for non-technical users**
- Natural language queries (no SQL required)
- Conversational agent interface
- Clear citations for trust

---

## 👥 Team & Acknowledgments

**Built for:** Virtue Foundation Ghana Initiative  
**Challenge:** Databricks Hackathon 2024  
**Track:** Healthcare Intelligence & Medical Desert Analysis

**Technologies:**
- Databricks (Unity Catalog, Vector Search, Workflows, MLflow)
- LangChain (Agent framework)
- FastAPI (Backend)
- Delta Lake (Storage)
- PySpark (Processing)

**Dataset Source:**
- Virtue Foundation Ghana v0.3
- 987 healthcare facilities
- Real-world messy data

---

## 📞 Contact & Links

**Live Demo:** [Coming Soon]  
**MLflow Experiment:** [Link to Databricks workspace]  
**Databricks Repo:** [Link to repo]  
**GitHub:** [Your GitHub repo]  
**API Documentation:** `http://localhost:8000/docs` (FastAPI auto-docs)

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🙏 Why It Matters

> "Every data point you extract represents a patient who could receive care sooner. By automating understanding from medical notes — the most critical AI agent use case in healthcare — we're creating the intelligence layer that can transform scarcity into coordinated action and bring lifesaving expertise to the world's most underserved regions."

This system doesn't just identify problems — it provides **actionable intelligence** for:
- **NGOs** to allocate volunteers
- **Governments** to plan infrastructure
- **Healthcare workers** to find collaboration opportunities
- **Patients** to access care faster

At planetary scale, even small improvements in coordination mean **millions of patients treated sooner** and **countless lives saved**.

---

**Built with ❤️ for healthcare equity**