<div align="center">

<br/>

<img src="./frontend/public/intro.png" alt="Virtue Foundation — Ghana Healthcare Intelligence" width="100%" />

### *Bridging Medical Deserts with AI, Agentic Orchestration & Databricks*

<br/>

[![Databricks](https://img.shields.io/badge/Databricks-FF3621?style=for-the-badge&logo=databricks&logoColor=white)](https://databricks.com)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React_+_Vite-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev)
[![LangGraph](https://img.shields.io/badge/LangGraph-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white)](https://langchain-ai.github.io/langgraph/)
[![Python](https://img.shields.io/badge/Python_3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)

[![FAISS](https://img.shields.io/badge/FAISS-Offline_RAG-blueviolet?style=flat-square)](https://faiss.ai)
[![Llama](https://img.shields.io/badge/Llama--3_70B-via_Databricks-ff6b35?style=flat-square)](https://llama.meta.com)
[![MLflow](https://img.shields.io/badge/MLflow-Traceability-0194E2?style=flat-square)](https://mlflow.org)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=flat-square&logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

<br/>

**[🚀 Live Demo](https://virtue-foundation-ghana-dd.vercel.app)** · **[📖 Architecture](#%EF%B8%8F-architecture--data-flow)** · **[🤖 Agent Docs](#-langgraph-14-node-agent)** · **[⚡ Quickstart](#-quickstart)**

> ⚠️ *Initial load may take ~2 min due to cold starts. Refresh once for optimal performance.*

</div>

---

## 🌍 What Is This?

The **Virtue Foundation Ghana Healthcare Intelligence Platform** is a next-generation, full-stack agentic AI system built for the **Databricks × Accenture Hackathon**. It transforms raw, unstructured healthcare facility data from across Ghana into a living, queryable intelligence layer — exposing critical medical deserts, data anomalies, staffing gaps, and intervention opportunities through a conversational AI agent and an interactive geospatial dashboard.

Designed for **NGO planners, clinicians, and data scientists**, the platform enables evidence-based healthcare resource allocation where it matters most.

---

## 📊 Pipeline Results at a Glance

<div align="center">

| Metric | Value |
|:---|---:|
| 🏥 Facilities Processed | **900+** |
| 🗺️ Ghana Regions Scored | **16** |
| ⚠️ Anomalies Flagged | **340+** |
| 🔴 Severe Medical Deserts | **2** (Savannah, Upper East) |
| 🟢 Adequate Coverage Regions | **5** (incl. Greater Accra, Eastern) |
| 🩺 Specialties Mapped | **30+** |
| 🧠 IDP Extraction Phases | **15** per record |
| 🤖 LangGraph Agent Nodes | **14** |
| 💬 MoSCoW Query Categories | **59** |
| 📐 Dashboard Views | **6** distinct pages |

</div>

---

## 🌵 Medical Desert Score Sample Output

<div align="center">

| Region | Label | MDS Score | Critical Gaps |
|:---|:---|:---:|:---|
| Savannah | 🔴 **Severe Desert** | `0.87` | Emergency Medicine · Surgery · Obstetrics · Pediatrics |
| Upper East | 🔴 **Severe Desert** | `0.84` | Emergency Medicine · Surgery · Obstetrics |
| Bono East | 🟡 **Moderate Desert** | `0.68` | General Surgery |
| Oti | 🟡 **Moderate Desert** | `0.71` | Pediatrics · Mental Health |
| Greater Accra | 🟢 **Adequate** | `0.39` | — |
| Eastern | 🟢 **Adequate** | `0.49` | — |

> **MDS (Medical Desert Score):** `0.0` = full coverage · `1.0` = complete healthcare desert

</div>

---

## 📸 Platform in Action

### 📊 Dashboard — Live KPI Intelligence
#### *Real-time KPI counters showing total facilities, hospitals, clinics, NGO partners, average Medical Desert Scores, and critical region counts across Ghana's 16 administrative regions.*
![Dashboard](./frontend/public/dashboard.gif)

---

### 🗺️ Map Explorer — Geospatial Visualization
#### *Interactive Leaflet map with 900+ geocoded facility markers, medical desert heatmap overlays, regional boundary polygons, and facility detail popups with clinical capability badges.*
![Map Explorer](./frontend/public/mapfacility.gif)

---

### 🌵 Desert Analysis — Regional Vulnerability Scoring
#### *Regional Medical Desert Scores (MDS) ranked by severity, with specialty gap breakdowns, bed-to-population ratio charts, and AI-generated recommended intervention actions.*
![Desert Analysis](./frontend/public/desert.gif)

---

### ⚠️ Anomaly Report — Clinical Data Integrity
#### *Data integrity flags sorted by severity — automatically detecting impossible configurations such as clinics claiming ICU capabilities with zero doctors or no electricity supply.*
![Anomaly Report](./frontend/public/screenshot_anomalies.png)

---

### 🤖 AI Agent — Real-Time Chat Interface
#### *Streaming chat panel with step-by-step reasoning timeline, dynamically generated SQL code display, document citations with confidence scores, and suggested query prompts.*
![AI Agent](./frontend/public/aichat.gif)

---

### 🏥 Facility Explorer — Searchable Registry
#### *Searchable and filterable registry of all 900+ healthcare facilities with clinical capability badges, infrastructure status, operator type classification, and geographic metadata.*
![Facility Explorer](./frontend/public/facility.gif)

---

## ✨ Core Capabilities

### 🧠 Intelligent Document Parsing (IDP)
A **15-phase extraction pipeline** powered by **Llama-3 70B** via Databricks Model Serving. Splits entities into facilities vs. NGOs, parses free-form clinical narratives into structured arrays of procedures, equipment, and capabilities, then maps everything to 30+ standardized medical specialty categories.

### 🌵 Medical Desert Detection & Scoring
Computes a **Medical Desert Score (MDS)** per region based on bed counts, doctor-to-population ratios, specialty coverage, and infrastructure. Ranks all 16 Ghana regions from `0.0` (adequate) to `1.0` (severe desert) and surfaces actionable intervention recommendations.

### ⚠️ Anomaly Detection & Data Audit
Rule-based engine that cross-checks equipment claims against reported staffing and infrastructure. Flags implausible records (e.g., ICU claims with zero staff, surgical equipment without electricity) with severity labels and confidence scores.

### 🤖 Agentic Natural Language Interface
A compiled **14-node LangGraph StateGraph** routes every query through exactly the right combination of SQL, RAG, geospatial, and reasoning nodes — then synthesizes a unified answer with **row-level citations**, SQL trace, and confidence scores, streamed live via **Server-Sent Events (SSE)**.

### 🗺️ Interactive Geospatial Dashboard
React + Leaflet dashboard with **choropleth desert heatmaps**, geocoded facility markers, regional boundary layers, and facility detail popups — built for field planners who need spatial context.

### 🔁 Dual-Mode Retrieval (Databricks + FAISS)
Databricks Vector Search is the primary retrieval backend. A precomputed **local FAISS index** (`faiss_index.bin`) enables fully offline demos and production fallback with no code changes.

---

## 🛠️ Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA INGESTION LAYER                              │
│                                                                             │
│   Raw CSVs ──┐                                                              │
│   GeoJSON   ─┼──► 01_ingest_bronze ──► bronze_facilities_raw (Delta)       │
│   Text PDFs ─┘                                                              │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ ETL
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SILVER CLEANING LAYER                               │
│                                                                             │
│   02_transform_silver ──► silver_facilities_cleaned (Delta)                 │
│   (Dedup · Geo-parse · Standardize operators · Validate · E.164 phones)     │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ Enrich
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GOLD ENRICHMENT LAYER                              │
│                                                                             │
│   03_build_gold ────────────────► gold_facilities_enriched                  │
│   04_idp_agent  (Llama-3 70B) ──► gold_idp_enriched                        │
│   07_desert_scoring ────────────► gold_medical_desert_scores                │
│   08_anomaly_detection ─────────► gold_anomaly_flags                        │
└──────────────┬──────────────────────────────┬───────────────────────────────┘
               │ Embed & Index                │ Query
               ▼                             ▼
┌──────────────────────────┐   ┌─────────────────────────────────────────────┐
│  Databricks Vector Search │   │              FastAPI Backend                │
│  Index (Primary RAG)      │   │  ┌───────────────────────────────────────┐ │
│                           │   │  │   LangGraph 14-Node StateGraph        │ │
│  + FAISS Local Fallback   │◄──┤  │   router → sql/rag/geo/anomaly/...    │ │
│  (faiss_index.bin)        │   │  │   → synthesiser → SSE stream          │ │
└──────────────────────────┘   │  └───────────────────────────────────────┘ │
                               │  Redis Cache · SQL Warehouse Connector      │
                               └─────────────────────┬───────────────────────┘
                                                     │ SSE / REST
                                                     ▼
                               ┌─────────────────────────────────────────────┐
                               │         React Frontend (Vite + TS)          │
                               │                                             │
                               │  📊 Dashboard  ·  🗺️ Map Explorer           │
                               │  🤖 AI Agent   ·  🏥 Facility Explorer      │
                               │  🌵 Desert Analysis  ·  ⚠️ Anomaly Report   │
                               └─────────────────────────────────────────────┘
```
---
![](./databricks/mermaid-diagram.png)

---

## 🗄️ `databricks/notebooks/` — Deep Dive

The Databricks notebooks implement the full **Medallion Architecture** (Bronze → Silver → Gold), AI extraction, anomaly detection, and vector indexing pipelines. Every notebook is numbered to reflect its execution order.

### 🥉 Bronze Layer — Raw Ingestion

#### [`01_ingest_bronze_v2.ipynb`](databricks/notebooks/01_ingest_bronze_v2.ipynb)
- **Role**: Entry point for the entire data pipeline.
- **Input Sources**: Raw CSV facility registries, `ghana_facilities.geojson` boundary file, and unstructured free-text NGO reports.
- **Process**: Reads multi-format sources using PySpark, applies minimal schema enforcement, and writes as-is into Unity Catalog Delta Lake.
- **Output Table**: `virtue_foundation.ghana.bronze_facilities_raw`

---

### 🥈 Silver Layer — Cleaning & Standardization

#### [`02_transform_silver.ipynb`](databricks/notebooks/02_transform_silver.ipynb)
- **Role**: Data quality and standardization layer.
- **Process**:
  - Drops exact duplicate records using SHA hashing on key columns.
  - Parses and validates latitude/longitude coordinates — strips non-numeric artifacts, coerces to float.
  - Standardizes `region` names to match official Ghana administrative districts.
  - Formats telephone numbers to international E.164 standard.
  - Maps inconsistent operator names (e.g. "faith-based", "FBO", "religious") to canonical categories.
  - Handles null fields with configurable defaults per column type.
- **Output Table**: `virtue_foundation.ghana.silver_facilities_cleaned`

---

### 🥇 Gold Layer — Enrichment, Scoring & AI Extraction

#### [`03_build_gold.ipynb`](databricks/notebooks/03_build_gold.ipynb)
- **Role**: Geospatial enrichment and administrative boundary mapping.
- **Process**: Performs a geospatial join using facility `lat/lon` coordinates against the GeoJSON polygon collection to determine the official `region`, `district`, and `sub-district` for every record.
- **Output Table**: `virtue_foundation.ghana.gold_facilities_enriched`

#### [`04_idp_agent.ipynb`](databricks/notebooks/04_idp_agent.ipynb) · [`04_idp_agent.py`](databricks/notebooks/04_idp_agent.py)
- **Role**: Core **Intelligent Document Processing (IDP)** engine. The most complex notebook in the pipeline.
- **Process** — 15-phase extraction pipeline powered by **Llama-3 70B** via `ai_query()`:
  1. **Entity Classification**: Splits records into `facility`, `ngo`, or `other_organization`.
  2. **Free-Form Parsing**: Extracts unstructured paragraphs into `procedures[]`, `equipment[]`, and `capabilities[]` arrays.
  3. **Specialty Ontology Mapping**: Maps extracted procedures (e.g. `"cesarean section"`) to 30+ standardized medical specialty codes (e.g. `gynecologyAndObstetrics`).
  4. **Null-Fill Batching**: Clusters missing attributes (email, website, founding year) and resolves them in a single batched LLM call.
  5. **Confidence Scoring**: Assigns an extraction confidence score to each enriched record.
- **Execution Mode**: Uses `ThreadPoolExecutor` with 12 parallel threads for concurrent model serving calls.
- **Output Table**: `virtue_foundation.ghana.gold_idp_enriched`

#### [`07_medical_desert_scoring.ipynb`](databricks/notebooks/07_medical_desert_scoring.ipynb)
- **Role**: Healthcare accessibility vulnerability calculator.
- **Process**: Computes a composite **Medical Desert Score (MDS v12)** per region using:
  - `density_component`: Facilities and hospitals per 100k population.
  - `specialty_component`: Weighted score based on presence/absence of 10 critical specialties.
  - `integrity_component`: Penalizes low data quality and high anomaly rates.
  - `confidence_component`: Adjusts score based on completeness of source data.
  - Final `blended_mds`: Weighted average of all four components (v12 algorithm).
- **Output**: Desert label categories: `Severe Desert`, `Moderate Desert`, `Marginal`, `Adequate`.
- **Output Table**: `virtue_foundation.ghana.gold_medical_desert_scores`

#### [`08_anomaly_detection_v2.ipynb`](databricks/notebooks/08_anomaly_detection_v2.ipynb)
- **Role**: Clinical plausibility and data integrity auditor.
- **Process**: Evaluates 20+ rule-based checks including:
  - ICU beds reported with zero clinical staff.
  - Surgical capabilities claimed without anaesthesia equipment.
  - Advanced diagnostics reported without electricity infrastructure.
  - Hospital beds count exceeding documented room capacity by >10×.
  - Coordinates outside Ghana's geographic bounding box.
- **Output Table**: `virtue_foundation.ghana.gold_anomaly_flags`

---

### 🔍 RAG Indexing & Agent Prototyping

#### [`05_rag_build_index.ipynb`](databricks/notebooks/05_rag_build_index.ipynb)
- **Role**: Semantic search index builder.
- **Process**:
  - Generates vector embeddings from facility descriptions, clinical narratives, and capability summaries using a Databricks BGE embedding endpoint.
  - Synchronizes embeddings to a **Databricks Vector Search Index** on `gold_idp_enriched`.
  - Simultaneously writes a local **FAISS index** (`faiss_index.bin`) and metadata (`faiss_metadata.json`) to `backend/rag_data/` as an offline fallback.
- **Output**: Live Databricks VS index + local FAISS binary files.

#### [`06_langgraph_agent.ipynb`](databricks/notebooks/06_langgraph_agent.ipynb)
- **Role**: Development prototyping workspace.
- **Purpose**: Used to design and test LangGraph node logic, intent classification routing, and tool validation before porting to the FastAPI backend.
- **Output & Test Demo**:
```
========================================================================
VIRTUE FOUNDATION v5.1 EVALUATION SUITE (24 queries)
========================================================================

[1.1] 'How many hospitals have cardiology in Ghana?'

======================================================================
Query      : How many hospitals have cardiology in Ghana?
Type       : regional_analysis (simple)
Plan       : ['sql']
Steps      : ['Router → regional_analysis | sql → []', "SQL: 1 rows | ['virtue_foundation.ghana.gold_idp_enriched']", 'Synthesiser: answer assembled']
Confidence : 0.10 | Halluc risk: 0.30
Citations  : 0 fac | 3 nodes
MLflow     : cb64e820a0144970adc45e4f6a2ef264
======================================================================

Answer:
According to facility records, there are 20 hospitals with cardiology services in Ghana. This information suggests that cardiology care is available in various parts of the country, but it would be beneficial to know the specific regions and distribution of these hospitals to identify potential gaps in service. 

7 of 16 regions in Ghana may have limited access to cardiology services, but without more detailed information, I have moderate confidence in this assessment. 

An interactive map with 20 markers is ready to provide a visual representation of the hospitals with cardiology services across Ghana. 

Recommended actions: 
1. Conduct a more detailed analysis of the distribution of hospitals with cardiology services to identify regions with limited access.
2. Collaborate with local health authorities to develop strategies for improving cardiology care in underserved regions.
3. Consider investing in telemedicine or outreach programs to expand access to cardiology services in areas with limited hospital availability.

  Type     : ✅ got='regional_analysis' expected='regional_analysis'
  Answer   : ✅ (1034 chars)
  Cits     : 0 fac / 3 nodes
  Quality  : conf=0.10 | halluc=0.30

[1.2] 'How many hospitals in Ashanti region have surgery?'

======================================================================
Query      : How many hospitals in Ashanti region have surgery?
Type       : regional_analysis (simple)
Plan       : ['sql']
Steps      : ['Router → regional_analysis | sql → []', "SQL: 1 rows | ['virtue_foundation.ghana.gold_idp_enriched']", 'Synthesiser: answer assembled']
Confidence : 0.10 | Halluc risk: 0.30
Citations  : 0 fac | 3 nodes
MLflow     : ef7e2a55374341d589e259283d97052f
======================================================================

Answer:
According to facility records, 16 hospitals in the Ashanti region have surgery capabilities. 

An interactive map with 16 markers is ready to provide a visual representation of these hospitals. 

Recommended actions: 
1. Conduct further analysis to assess the capacity and quality of surgical services at these hospitals.
2. Identify areas with high demand for surgical services and consider allocating resources to support these hospitals.

Note: The data only provides information on the number of hospitals with surgery capabilities and does not offer insights into the quality or capacity of these services. (moderate confidence)

  Type     : ✅ got='regional_analysis' expected='regional_analysis'
  Answer   : ✅ (633 chars)
  Cits     : 0 fac / 3 nodes
  Quality  : conf=0.10 | halluc=0.30

[1.3] 'What services does Korle Bu Teaching Hospital offer?'
FAISS loaded: 972 vectors from /Workspace/Users/dasdeepayan08@gmail.com/databricks_accenture_hackathon_virtue_foundationtrack/databricks/rag/faiss_index.bin

======================================================================
Query      : What services does Korle Bu Teaching Hospital offer?
Type       : facility_lookup (simple)
Plan       : ['rag']
Steps      : ['Router → facility_lookup | rag → []', 'RAG: 10 results', 'Synthesiser: answer assembled']
Confidence : 1.00 | Halluc risk: 0.10
Citations  : 6 fac | 3 nodes
MLflow     : 3443810d61224e75ae98e097cb393847
======================================================================

Answer:
According to facility records, Korle Bu Teaching Hospital, located in Accra, Greater Accra, offers various services. The hospital has specialties in cardiology and cardiac surgery, and provides procedures such as Electrocardiogram (ECG) testing, 2D Echocardiography (ECHO) testing, Exercise Stress Test, and Cardiac Consultation services. Additionally, Open heart surgeries are performed at the National Cardiothoracic Centre of the Korle Bu Teaching Hospital.

The hospital also has a Reproductive Health Centre that offers services such as gynecology and obstetrics, family planning and complex contraception, and reproductive endocrinology and infertility. The centre provides procedures including Cervical cancer screening, Cervical cancer vaccination, and Family planning services.

It's worth noting that the National Cardiothoracic Centre of the Korle Bu Teaching Hospital has its own set of specialties and procedures, including Holter Monitoring, Electrocardiogram (ECG) testing, 2D Electrocardiogram (ECHO) services, Exercise Stress Test, and Cardiac Consultation services.

Recommended actions for programme officers may include:
- Collaborating with Korle Bu Teaching Hospital to support their cardiology and cardiac surgery services
- Providing resources and training to the Reproductive Health Centre to enhance their family planning and reproductive health services
- Exploring opportunities to support the National Cardiothoracic Centre of the Korle Bu Teaching Hospital in their provision of specialized cardiac services.

An interactive map with 6 markers is ready to provide a visual representation of the locations and services offered by Korle Bu Teaching Hospital and other nearby facilities. (Moderate confidence)

  Type     : ✅ got='facility_lookup' expected='facility_lookup'
  Answer   : ✅ (1736 chars)
  Cits     : 6 fac / 3 nodes
  Quality  : conf=1.00 | halluc=0.10

[1.4] 'Are there any clinics in Kumasi that do dialysis?'

======================================================================
Query      : Are there any clinics in Kumasi that do dialysis?
Type       : facility_lookup (simple)
Plan       : ['rag']
Steps      : ['Router → facility_lookup | rag → []', 'RAG: 7 results', 'Synthesiser: answer assembled']
Confidence : 1.00 | Halluc risk: 0.10
Citations  : 6 fac | 3 nodes
MLflow     : 3dbaf175516e40db80e44149d184c9e5
======================================================================

Answer:
According to facility records, there is at least one clinic in Kumasi that provides dialysis services: FirstCare Health Services, located in Kumasi, Ashanti region. This clinic offers renal dialysis services, among other specialties such as internal medicine, gynecology and obstetrics, otolaryngology, general surgery, pediatrics, and psychiatry.

It's worth noting that while FirstCare Health Services provides dialysis services, there are other clinics in different regions that specialize in dialysis, such as Global Dialysis Centre, FAB Mercy Dialysis Center, and Labone Dialysis Centre, all located in Accra, Greater Accra region. Additionally, Wipe-Away Foundation in Damongo, Savannah region, also offers nephrology services, although it's not explicitly stated that they provide dialysis.

Recommended actions: 
1. Verify the current availability and quality of dialysis services at FirstCare Health Services in Kumasi.
2. Consider partnering with other dialysis clinics in Accra to expand access to dialysis services in the country.
3. Explore the possibility of supporting Wipe-Away Foundation in Damongo to develop their nephrology services, potentially including dialysis.

An interactive map with 6 markers is ready to visualize the locations of these clinics. (Moderate confidence)

  Type     : ✅ got='facility_lookup' expected='facility_lookup'
  Answer   : ✅ (1296 chars)
  Cits     : 6 fac / 3 nodes
  Quality  : conf=1.00 | halluc=0.10

[1.5] 'Which region in Ghana has the most hospitals?'

======================================================================
Query      : Which region in Ghana has the most hospitals?
Type       : regional_analysis (simple)
Plan       : ['sql']
Steps      : ['Router → regional_analysis | sql → []', "SQL: 1 rows | ['virtue_foundation.ghana.gold_regional_summary']", 'Synthesiser: answer assembled']
Confidence : 0.10 | Halluc risk: 0.30
Citations  : 0 fac | 3 nodes
MLflow     : 384f3a51a7fc4245a0b4abbc112bd0d4
======================================================================

Answer:
According to facility records, the Greater Accra region in Ghana has the most hospitals. Unfortunately, with only 1 record available, I have low confidence in this assessment, as it may not reflect the complete picture of hospital distribution across Ghana. To confirm this finding, I would recommend collecting and analyzing more comprehensive data on hospital locations and numbers across all 16 regions of Ghana. 

An interactive map with 1 marker is ready to visualize the available data. 

Recommended actions: 
1. Conduct a thorough survey to gather data on hospital locations and numbers in all 16 regions of Ghana.
2. Update the existing records to reflect the accurate distribution of hospitals across the country.
3. Analyze the updated data to identify regions with the most hospitals and those with limited access to healthcare facilities.

  Type     : ✅ got='regional_analysis' expected='regional_analysis'
  Answer   : ✅ (851 chars)
  Cits     : 0 fac / 3 nodes
  Quality  : conf=0.10 | halluc=0.30

[2.1] 'How many hospitals treating malaria are within 50km of Accra?'

======================================================================
Query      : How many hospitals treating malaria are within 50km of Accra?
Type       : geo_search (moderate)
Plan       : ['geo', 'medical']
Steps      : ["Router → geo_search | geo → ['medical']", 'Geo: 25 facilities within 50.0km of Accra | 0 cold spots', 'Medical reasoning: 2819 chars', 'Synthesiser: answer assembled']
Confidence : 0.80 | Halluc risk: 0.31
Citations  : 0 fac | 4 nodes
MLflow     : b0d554acb29b4c1d959823eb939c6dd2
======================================================================

Answer:
Based on the provided evidence, there are 25 facilities within 50km of Accra. Out of these, at least 2 hospitals (Ghana Police Hospital and Accra Psychiatric Hospital) are capable of treating malaria, considering they have services for infectious disease. 

According to facility records, the Ghana Police Hospital, located 1.62km from Accra, has a facility type of "hospital" and has services for emergency medicine, surgery, obstetrics, radiology, infectious disease, and pediatrics. The Accra Psychiatric Hospital, located in Accra, has emergency medicine services but lacks surgery, ICU, obstetrics, and radiology services.

7 of 10 hospitals within 50km of Accra lack ICU services, including Ghana Police Hospital and Accra Psychiatric Hospital. This poses a significant concern for critical care services in the region.

An interactive map with 25 markers is ready to visualize the locations of these facilities.

Recommended actions for NGOs operating in the Greater Accra region include:
- Collaborating with the Ghanaian government to establish ICU services in major hospitals like Ghana Police Hospital and Accra Psychiatric Hospital.
- Providing training and resources to alternative medicine facilities like Mizprom Herbal Centre to enhance their services and capabilities.
- Supporting the development of comprehensive medical care services in the region to address the workforce and infrastructure gaps.

These recommendations are made with moderate confidence (60%) due to the limitations of the available data and the potential for misrepresentation of services by some facilities.

  Type     : ✅ got='geo_search' expected='geo_search'
  Answer   : ✅ (1597 chars)
  Cits     : 0 fac / 4 nodes
  Quality  : conf=0.80 | halluc=0.31

[2.2] 'Which facilities are within 30km of Tamale?'

======================================================================
Query      : Which facilities are within 30km of Tamale?
Type       : geo_search (moderate)
Plan       : ['geo', 'medical']
Steps      : ["Router → geo_search | geo → ['medical']", 'Geo: 22 facilities within 30.0km of Tamale | 0 cold spots', 'Medical reasoning: 3053 chars', 'Synthesiser: answer assembled']
Confidence : 0.80 | Halluc risk: 0.31
Citations  : 0 fac | 4 nodes
MLflow     : 54da29b850cb4800bf73c4e8bc6d287f
======================================================================

Answer:
There are 22 facilities within 30km of Tamale. According to facility records, three of these facilities are: 
1. **Cape Coast Teaching Hospital**, a hospital located 1.6km from Tamale, offering a range of services including emergency medicine, surgery, ICU, obstetrics, radiology, and pediatrics.
2. **Ummah Medical Center**, a hospital also 1.6km from Tamale, but lacking specialized services such as emergency medicine, surgery, and ICU.
3. **Universal Health Clinic**, a clinic 1.6km from Tamale, offering radiology services but lacking emergency medicine, surgery, ICU, obstetrics, and pediatrics.

An interactive map with 22 markers is ready to visualize the distribution of these facilities around Tamale.

Recommended actions for NGOs in the Northern region, with a focus on Tamale, include:
1. **Equipment Donation to Ummah Medical Center**: Donating equipment to enhance basic emergency and surgical capabilities.
2. **Training and Capacity Building in Universal Health Clinic**: Providing targeted training programs for staff to enhance service offerings.
3. **Supporting Cape Coast Teaching Hospital**: Offering resources to support the hospital's comprehensive range of services, ensuring continued access to advanced medical care for the local population.

These interventions could help address the gaps in healthcare services and infrastructure in the region, improving the overall healthcare maturity score and reducing the medical desert score. (Moderate confidence)

  Type     : ✅ got='geo_search' expected='geo_search'
  Answer   : ✅ (1483 chars)
  Cits     : 0 fac / 4 nodes
  Quality  : conf=0.80 | halluc=0.31

[2.3] 'Where are the largest geographic cold spots where surgery is abse'

======================================================================
Query      : Where are the largest geographic cold spots where surgery is absent?
Type       : desert_analysis (complex)
Plan       : ['geo', 'desert', 'sql']
Steps      : ["Router → desert_analysis | desert → ['geo', 'sql']", 'Desert: 17 regions | 2 Severe | 2 cold spots', 'Geo: 69 facilities within 50.0km of Accra | 4 cold spots', "SQL: 2 rows | ['virtue_foundation.ghana.gold_regional_summary']", 'Synthesiser: answer assembled']
Confidence : 0.63 | Halluc risk: 0.20
Citations  : 0 fac | 5 nodes
MLflow     : ced13f293b814326b2e0b3d818760a2e
======================================================================

Answer:
According to facility records, 2 of 17 regions in Ghana lack surgical capabilities. The Savannah region has a medical desert score of 0.970600009, indicating a severe lack of healthcare services, including surgery. The Upper East region also has a high medical desert score of 0.935199976, suggesting significant gaps in healthcare services.

Our analysis of 69 facilities within 50km of Accra shows that while some facilities like Ghana Police Hospital and Inter-Star Eye Clinic and Laser Center have surgical capabilities, there are large geographic areas without access to surgical care.

Specifically, 7 of 17 regions lack emergency medicine, and 2 regions, Savannah and Upper East, have severe medical desert scores and are missing critical specialties, including general surgery. The Savannah region has 4 facilities, but none of them provide surgical services, resulting in a surgical access gap score of 1.0.

An interactive map with 4 markers is ready to visualize these cold spots. 

Recommended actions for the Savannah region include:
1. URGENT: Deploy emergency medicine capacity — zero coverage detected
2. URGENT: No surgical capacity — patients cannot receive operative care
3. URGENT: No obstetrics — elevated maternal mortality risk

For the Upper East region, recommended actions include:
1. URGENT: Deploy emergency medicine capacity — zero coverage detected
2. URGENT: No surgical capacity — patients cannot receive operative care
3. URGENT: No obstetrics — elevated maternal mortality risk

We have moderate confidence in these findings, given the data completeness score of 0.8399999737739563 for the Ghana Police Hospital and 0.9010000228881836 for the Inter-Star Eye Clinic and Laser Center.

  Type     : ⚠️ got='desert_analysis' expected='geo_search'
  Answer   : ✅ (1716 chars)
  Cits     : 0 fac / 5 nodes
  Quality  : conf=0.63 | halluc=0.20

[4.1] 'Which facilities have implausible ICU claims without infrastructu'

======================================================================
Query      : Which facilities have implausible ICU claims without infrastructure?
Type       : anomaly_analysis (complex)
Plan       : ['anomaly', 'graph', 'medical']
Steps      : ["Router → anomaly_analysis | anomaly → ['graph', 'medical']", 'Anomaly: 30 flagged | report: 10 regions', 'Capability graph: 40 findings', 'Medical reasoning: 3165 chars', 'Synthesiser: answer assembled']
Confidence : 0.85 | Halluc risk: 0.33
Citations  : 0 fac | 5 nodes
MLflow     : 70f068526a944e7c9a67e6a4f286315c
======================================================================

Answer:
Based on our analysis, we have identified 3 facilities with implausible ICU claims without infrastructure: 

1. Shekhinah Clinic in Tamale, Northern region, which claims to have ICU and surgery services but has zero equipment, raising concerns about its ability to provide these services.
2. Beaver Medical, which has 7 gaps in its dependency chain, including emergency:ambulance_or_referral, emergency:oxygen, and obstetrics:delivery_room, with a confidence level of 0.87.
3. Center for Cosmetic Surgery, Ghana, which has 3 gaps in its dependency chain, including surgery:sterilization, surgery:blood_support, and surgery:recovery_beds, with a confidence level of 0.87.

According to facility records, Shekhinah Clinic's claim of ICU services without oxygen, patient monitoring, trained staff, and beds is suspicious, with a confidence level of 0.75. 

We have moderate confidence that these facilities may be misrepresenting their capabilities, and we recommend verifying their ICU and surgery capabilities. 

Recommended actions:
- Verify ICU and surgery capabilities at Shekhinah Clinic, Beaver Medical, and Center for Cosmetic Surgery, Ghana.
- Conduct a thorough assessment of the infrastructure and equipment available at these facilities to support complex medical procedures.
- Provide training and support to healthcare professionals in the Northern region to address the workforce gap.
- Consider investing in essential equipment such as oxygen and patient monitoring systems to support ICU services in the region.

An interactive map with 3 markers is ready to visualize the locations of these facilities.

  Type     : ✅ got='anomaly_analysis' expected='anomaly_analysis'
  Answer   : ✅ (1617 chars)
  Cits     : 0 fac / 5 nodes
  Quality  : conf=0.85 | halluc=0.33

[4.2] 'Show facilities with enhanced ghost hospital flags'

======================================================================
Query      : Show facilities with enhanced ghost hospital flags
Type       : anomaly_analysis (complex)
Plan       : ['anomaly', 'graph', 'medical']
Steps      : ["Router → anomaly_analysis | anomaly → ['graph', 'medical']", 'Anomaly: 30 flagged | report: 10 regions', 'Capability graph: 40 findings', 'Medical reasoning: 2896 chars', 'Synthesiser: answer assembled']
Confidence : 0.85 | Halluc risk: 0.33
Citations  : 0 fac | 5 nodes
MLflow     : 52b2cc593bcf4cf9ae0586112a58c984
======================================================================

Answer:
Based on the provided evidence, I have identified facilities with enhanced ghost hospital flags. 

1. **Facilities with Enhanced Ghost Hospital Flags**: 
Unfortunately, none of the facilities in the provided evidence have an "enhanced_ghost_hospital" flag set to true. However, Shekhinah Clinic in Tamale, Northern Region, has a "ghost_probability_score" of 0.25999999046325684, indicating a moderate risk of being a ghost hospital. 

2. **Facilities with Capability Mismatch**: 
Shekhinah Clinic has an "enhanced_type_capability_mismatch" flag set to true, indicating a mismatch between its claimed capabilities and its actual facilities. Specifically, the clinic claims to have ICU and surgery services, but its clinic-tier status and lack of equipment raise suspicions.

3. **Facilities with Capability Dependency Gaps**: 
Beaver Medical and Center for Cosmetic Surgery, Ghana, have significant gaps in their dependency chains. Beaver Medical has 7 gaps, including emergency:ambulance_or_referral, emergency:oxygen, and obstetrics:delivery_room, with a confidence level of 0.87. Center for Cosmetic Surgery, Ghana, has 3 gaps, including surgery:sterilization, surgery:blood_support, and surgery:recovery_beds, with a confidence level of 0.87.

4. **Regions with Workforce and Infrastructure Gaps**: 
The Northern Region, where Shekhinah Clinic is located, has a significant workforce and infrastructure gap. The region's healthcare maturity score is 0.6107, indicating a need for improvement. 

**Recommended Actions**: 

* Verify the capabilities of Shekhinah Clinic, Beaver Medical, and Center for Cosmetic Surgery, Ghana, to ensure they align with their claimed services.
* Address the dependency gaps in Beaver Medical and Center for Cosmetic Surgery, Ghana, to ensure they have the necessary infrastructure and equipment to provide their claimed services.
* Improve the workforce and infrastructure in the Northern Region to support the provision of adequate healthcare services.

**Confidence Level**: 
The confidence level for these findings is moderate to high, ranging from 0.75 to 0.95, depending on the specific facility and finding. 

An interactive map with 3 markers is ready to visualize the locations of these facilities.

  Type     : ✅ got='anomaly_analysis' expected='anomaly_analysis'
  Answer   : ✅ (2240 chars)
  Cits     : 0 fac / 5 nodes
  Quality  : conf=0.85 | halluc=0.33

[4.4] 'Which facilities claim an unrealistic number of procedures?'

======================================================================
Query      : Which facilities claim an unrealistic number of procedures?
Type       : anomaly_analysis (complex)
Plan       : ['anomaly', 'graph', 'medical']
Steps      : ["Router → anomaly_analysis | anomaly → ['graph', 'medical']", 'Anomaly: 30 flagged | report: 10 regions', 'Capability graph: 40 findings', 'Medical reasoning: 3628 chars', 'Synthesiser: answer assembled']
Confidence : 0.85 | Halluc risk: 0.33
Citations  : 0 fac | 5 nodes
MLflow     : a1d3ea34b2e5447487e03cef71faedfd
======================================================================

Answer:
Based on our analysis, 3 facilities claim an unrealistic number of procedures: Shekhinah Clinic in Tamale, Northern region, Beaver Medical, and Center for Cosmetic Surgery, Ghana. 

According to facility records, Shekhinah Clinic claims to have ICU and surgery services, but has zero equipment, which is implausible. The clinic has a procedure count of 2, which is low considering its claimed capabilities. 

Beaver Medical has 7 gaps in its dependency chain, including emergency:ambulance_or_referral, emergency:oxygen, and obstetrics:delivery_room, with a confidence level of 0.87. Center for Cosmetic Surgery, Ghana, has 3 gaps, including surgery:sterilization, surgery:blood_support, and surgery:recovery_beds, with a confidence level of 0.87. 

We have moderate confidence that these facilities may be misrepresenting their capabilities. 

Recommended actions: 
1. Verify ICU and surgery capabilities at Shekhinah Clinic.
2. Conduct a thorough assessment of the dependency chains at Beaver Medical and Center for Cosmetic Surgery, Ghana.
3. Provide training and equipment to address the gaps in workforce and infrastructure in the Northern region.

An interactive map with 3 markers is ready to visualize the locations of these facilities.

  Type     : ✅ got='anomaly_analysis' expected='anomaly_analysis'
  Answer   : ✅ (1244 chars)
  Cits     : 0 fac / 5 nodes
  Quality  : conf=0.85 | halluc=0.33

[4.8] 'Which facilities have unusually high procedure breadth vs minimal'

======================================================================
Query      : Which facilities have unusually high procedure breadth vs minimal infrastructure?
Type       : anomaly_analysis (complex)
P

... [*** WARNING: max output size exceeded, skipping output. ***] ...

pacity, surgical capacity, and obstetrics care, as well as addressing the critical physician shortage. An interactive map with 2 markers is ready to visualize the locations of these regions.

  Type     : ✅ got='desert_analysis' expected='desert_analysis'
  Answer   : ✅ (1045 chars)
  Cits     : 0 fac / 4 nodes
  Quality  : conf=0.95 | halluc=0.23

[5.3] 'What specialties are missing from the top 5 underserved regions?'

======================================================================
Query      : What specialties are missing from the top 5 underserved regions?
Type       : desert_analysis (moderate)
Plan       : ['desert', 'priority', 'medical']
Steps      : ["Router → desert_analysis | desert → ['priority', 'medical']", 'Desert: 17 regions | 2 Severe | 2 cold spots', 'Priority: 17 regions | P1=0 P2=14', 'Medical reasoning: 3010 chars', 'Synthesiser: answer assembled']
Confidence : 0.90 | Halluc risk: 0.30
Citations  : 0 fac | 5 nodes
MLflow     : 3c9419b86f404ff6be74a3b3e38a3aad
======================================================================

Answer:
According to facility records, 4 of the top 5 underserved regions, including Savannah, Upper East, and 2 other regions, lack critical specialties. Specifically, these regions are missing emergency medicine, general surgery, and gynecology and obstetrics. The Savannah region, in particular, also lacks pediatrics. 

In the Savannah region, there are 0 ICU facilities, 0 surgery facilities, and 0 obstetrics facilities, with a total of 0 doctors and 0 beds. The hospitals per 100k population is 0.49, which is extremely low. The average emergency readiness score is 0.0, indicating a complete lack of emergency care capacity.

The Upper East region also has a severe medical desert score, with a critical specialty gap count of 3, missing emergency medicine, general surgery, and gynecology and obstetrics.

Recommended actions for these regions include:
- URGENT: Deploy emergency medicine capacity 
- URGENT: Deploy surgical capacity 
- URGENT: Deploy obstetrics care 
- HIGH: Deploy pediatric care 

An interactive map with 17 markers is ready to visualize the medical desert scores and missing specialties across the regions. (Moderate confidence)

  Type     : ✅ got='desert_analysis' expected='desert_analysis'
  Answer   : ✅ (1150 chars)
  Cits     : 0 fac / 5 nodes
  Quality  : conf=0.90 | halluc=0.30

[5.4] 'Which regions have P1 or P2 intervention priority?'

======================================================================
Query      : Which regions have P1 or P2 intervention priority?
Type       : healthcare_planning (complex)
Plan       : ['planning', 'priority', 'ngo']
Steps      : ["Router → healthcare_planning | planning → ['priority', 'ngo']", 'Planning: 17 regions, plan=2664 chars', 'Priority: 17 regions | P1=0 P2=14', 'NGO: 80 NGOs | 4 high-need regions without NGO coverage', 'Synthesiser: answer assembled']
Confidence : 0.50 | Halluc risk: 0.60
Citations  : 0 fac | 4 nodes
MLflow     : 99eab9e0b3d24b6c947977792ead6d1a
======================================================================

Answer:
According to the provided healthcare data, 4 of 17 regions have P1 or P2 intervention priority. Specifically, the Savannah region has a P2 intervention priority, with a regional priority score of 0.5192. 

The recommended interventions for the Savannah region include: 
1. Strengthening emergency stabilization, ambulance routing, and triage, 
2. Performing targeted operational verification of flagged facilities, 
3. Deploying diagnostic, surgical, and emergency equipment to address infrastructure gaps, 
4. Addressing workforce shortages by deploying rotating clinicians and specialist outreach, and 
5. Considering NGO mobile outreach and rotating specialist deployment programs.

An interactive map with 17 markers is ready to visualize the regional priorities and intervention needs.

In terms of NGO coverage gaps, 7 of 17 regions lack NGO presence, including Western North, Oti, Brong-Ahafo, and Ahafo. The Western North region, in particular, has a moderate desert score of 0.7262 and lacks critical specialties, ICU facilities, and emergency medicine facilities.

Recommended actions for the Western North region include:
1. Deploying emergency medicine teams to reduce mortality rates, 
2. Recruiting and training healthcare staff, and procuring medical equipment to increase the healthcare workforce, 
3. Providing training and capacity building for healthcare staff to increase competency, and 
4. Establishing referral networks with nearby hospitals to increase referral rates.

These actions aim to address the immediate, medium-term, and long-term needs of the regions with P1 or P2 intervention priority, and to improve healthcare outcomes in these areas. (Moderate confidence)

  Type     : ⚠️ got='healthcare_planning' expected='priority_analysis'
  Answer   : ✅ (1695 chars)
  Cits     : 0 fac / 4 nodes
  Quality  : conf=0.50 | halluc=0.60

[5.5] 'What are the recommended interventions for Savannah region?'

======================================================================
Query      : What are the recommended interventions for Savannah region?
Type       : healthcare_planning (complex)
Plan       : ['planning', 'priority', 'ngo']
Steps      : ["Router → healthcare_planning | planning → ['priority', 'ngo']", 'Planning: 17 regions, plan=3638 chars', 'Priority: 17 regions | P1=0 P2=14', 'NGO: 80 NGOs | 4 high-need regions without NGO coverage', 'Synthesiser: answer assembled']
Confidence : 0.50 | Halluc risk: 0.60
Citations  : 0 fac | 4 nodes
MLflow     : ebbcdd82062341c59bdb840e92338219
======================================================================

Answer:
According to facility records, the Savannah region has a severe desert score and lacks essential medical specialties. Based on the regional priorities, I recommend the following interventions for the Savannah region:

1. **Strengthen emergency stabilization, ambulance routing, and triage**: This is a critical intervention to improve emergency care services in the region.
2. **Perform targeted operational verification of flagged facilities**: This will help identify and address any operational gaps in the existing facilities.
3. **Deploy diagnostic, surgical, and emergency equipment**: This will help address the critical infrastructure gap in the region.
4. **Deploy rotating clinicians and specialist outreach**: This will help address the urgent workforce shortage in the region.
5. **Consider NGO mobile outreach and rotating specialist deployment programs**: This will help improve access to specialized care in the region.

These interventions are recommended based on the regional priority score of 0.5192, which indicates a high level of need in the Savannah region. I have moderate confidence in these recommendations, as they are based on a comprehensive analysis of the facility records and regional priorities.

An interactive map with 4 markers is ready to provide more detailed information on the facilities and regions. 

Recommended actions for NGO programme officers:

* Collaborate with local authorities to deploy emergency medical teams to provide basic life-support services.
* Deliver essential medical supplies, including medications, equipment, and consumables, to the existing facilities.
* Recruit and deploy medical specialists, including emergency medicine, general surgery, gynecology and obstetrics, and pediatrics, to fill the gaps in the existing facilities.
* Upgrade the existing facilities with essential medical equipment, including ICU and surgical equipment.
* Provide training and capacity-building programs for the existing medical staff.

By implementing these interventions, we can improve access to healthcare services, reduce mortality rates, and enhance the overall quality of care in the Savannah region.

  Type     : ⚠️ got='healthcare_planning' expected='priority_analysis'
  Answer   : ✅ (2156 chars)
  Cits     : 0 fac / 4 nodes
  Quality  : conf=0.50 | halluc=0.60

[6.1] 'Which facilities have critical capability dependency gaps?'

======================================================================
Query      : Which facilities have critical capability dependency gaps?
Type       : capability_graph_reasoning (complex)
Plan       : ['graph', 'medical']
Steps      : ["Router → capability_graph_reasoning | graph → ['medical']", 'Capability graph: 40 findings', 'Medical reasoning: 4588 chars', 'Synthesiser: answer assembled']
Confidence : 0.50 | Halluc risk: 0.60
Citations  : 0 fac | 4 nodes
MLflow     : b1d12ebaf6034144851cc3694cd2ddfa
======================================================================

Answer:
Based on the capability graph analysis, 2 of 3 facilities examined have critical capability dependency gaps. Specifically, "Beaver Medical" (facility_id: 1d0ee1ff-f69e-46da-b58d-6a3158d9d6b5) has 7 high-severity gaps, including emergency:ambulance_or_referral, emergency:oxygen, emergency:trauma_stabilization, and obstetrics:delivery_room, with a confidence level of 0.87. "Center for Cosmetic Surgery, Ghana" (facility_id: 4b0410ba-7453-45ff-aef8-a1749d9e87ba) has 3 medium-severity gaps in the surgery domain, including sterilization, blood support, and recovery beds, with a confidence level of 0.87.

According to facility records, these gaps indicate a severe lack of necessary dependencies for critical services, suggesting that these facilities lack essential services and equipment for emergency, obstetric, and surgical care. The infrastructure completeness score for "Beaver Medical" is 0.222, and the healthcare maturity score is 0.267, indicating substantial deficiencies in physical infrastructure and organizational maturity.

Recommended actions include:
1. **Targeted Interventions**: Provide specific support to address the identified gaps, such as training for emergency and obstetric care, provision of essential equipment like oxygen supply and sterilization facilities, and enhancement of physical infrastructure.
2. **Workforce Development**: Invest in workforce training and recruitment to improve the healthcare maturity and service richness of these facilities.
3. **Infrastructure Enhancement**: Focus on improving the physical infrastructure of these facilities to support the delivery of comprehensive healthcare services.
4. **Monitoring and Evaluation**: Regularly monitor and evaluate the progress of these facilities in addressing their capability dependency gaps and provide ongoing support as needed.

An interactive map with 2 markers is ready to visualize the locations of these facilities and their respective capability gaps. (Moderate confidence)

  Type     : ✅ got='capability_graph_reasoning' expected='capability_graph_reasoning'
  Answer   : ✅ (1986 chars)
  Cits     : 0 fac / 4 nodes
  Quality  : conf=0.50 | halluc=0.60

[6.2] 'Where is the surgical workforce actually practicing in Ghana?'

======================================================================
Query      : Where is the surgical workforce actually practicing in Ghana?
Type       : facility_lookup (moderate)
Plan       : ['sql', 'map']
Steps      : ["Router → facility_lookup | sql → ['map']", 'RAG: 10 results', 'Map: 947 markers', 'Synthesiser: answer assembled']
Confidence : 1.00 | Halluc risk: 0.10
Citations  : 6 fac | 3 nodes
MLflow     : 9e8c8ba4dc134cdab34ffad32c9f0313
======================================================================

Answer:
According to facility records, 5 of 10 facilities in Ghana provide surgical services. These facilities are located in the following regions: 

1. Ashanti - Christian Health Association of Ghana in Kumasi provides general surgery services.
2. Northern - Le Mete NGO Ghana in Tamale and Ospedale Didattico di Tamale in Tamale provide general surgery, urology, and other surgical services.
3. Western - GPHA Clinic in Takoradi provides gynecology and obstetrics, otolaryngology, and urology services.
4. Greater Accra - FOCOS Orthopaedic Hospital Ghana in Accra provides orthopedic surgery services.

Additionally, SVG Africa conducted surgeries during a health mission in the Kwahu Districts in Ghana, although the exact location of this facility is unknown.

An interactive map with 947 markers is ready to provide more detailed information on the location and services of these facilities.

Recommended actions: 
- Further research is needed to determine the exact location of SVG Africa and its current surgical capabilities.
- The Virtue Foundation may consider partnering with these facilities to support their surgical services and expand access to healthcare in Ghana.
- Moderate confidence in the data, as some facility information may be incomplete or outdated.

  Type     : ⚠️ got='facility_lookup' expected='regional_analysis'
  Answer   : ✅ (1268 chars)
  Cits     : 6 fac / 3 nodes
  Quality  : conf=1.00 | halluc=0.10

[7.1] 'How many ICU-capable facilities exist per region?'

======================================================================
Query      : How many ICU-capable facilities exist per region?
Type       : regional_analysis (simple)
Plan       : ['sql']
Steps      : ['Router → regional_analysis | sql → []', "SQL: 11 rows | ['virtue_foundation.ghana.gold_idp_enriched']", 'Synthesiser: answer assembled']
Confidence : 1.00 | Halluc risk: 0.30
Citations  : 0 fac | 3 nodes
MLflow     : a8841515ff6a48d8bb34bf7bd7be05bd
======================================================================

Answer:
According to facility records, there are 11 regions with ICU-capable facilities in Ghana. The distribution of these facilities per region is as follows: 

- 4 facilities in the Northern region
- 5 facilities in the Volta region
- 18 facilities in the Greater Accra region
- 7 facilities in the Ashanti region
- 2 facilities in the Ahafo region
- 3 facilities in the Brong-Ahafo region
- 3 facilities in the Eastern region
- 2 facilities in the Western region
- 1 facility in the Central region
- 1 facility in the Upper West region
- 2 facilities in the Oti region

Notably, 7 of 11 regions have 5 or fewer ICU-capable facilities, with the Central and Upper West regions having the least, at 1 facility each. 

An interactive map with 11 markers is ready to provide a visual representation of the distribution of ICU-capable facilities across these regions.

Recommended actions: 
1. The Virtue Foundation may consider prioritizing the Central and Upper West regions for further investment in ICU-capable facilities, given their limited capacity.
2. The foundation could also explore opportunities to support existing facilities in regions with fewer ICU-capable facilities, such as Ahafo, Western, and Oti, to enhance their capacity and improve healthcare outcomes.

  Type     : ✅ got='regional_analysis' expected='regional_analysis'
  Answer   : ✅ (1266 chars)
  Cits     : 0 fac / 3 nodes
  Quality  : conf=1.00 | halluc=0.30

[7.5] 'Which procedures depend on very few facilities in Ghana?'

======================================================================
Query      : Which procedures depend on very few facilities in Ghana?
Type       : specialty_gap_analysis (moderate)
Plan       : ['sql', 'medical']
Steps      : ["Router → specialty_gap_analysis | sql → ['medical']", "SQL: 0 rows | ['virtue_foundation.ghana.gold_idp_enriched']", 'Medical reasoning: 4496 chars', 'Synthesiser: answer assembled']
Confidence : 0.20 | Halluc risk: 0.50
Citations  : 0 fac | 4 nodes
MLflow     : 495ee92052ea4eca83e4b486017e4800
======================================================================

Answer:
Based on our analysis of Ghana's healthcare system, we have identified several procedures that depend on very few facilities. 

1. **Cardiothoracic surgery and neurosurgery**: These complex procedures are highly concentrated in a few major facilities, including the Korle Bu Teaching Hospital in Accra and the Komfo Anokye Teaching Hospital in Kumasi. According to facility records, the Korle Bu Teaching Hospital has a well-equipped ICU with a capacity of 20 beds, while the Komfo Anokye Teaching Hospital has a surgical department with 10 operating theaters.

2. **Organ transplantation**: This procedure is dependent on the availability of specialized equipment and personnel at facilities like the Korle Bu Teaching Hospital and the Komfo Anokye Teaching Hospital. However, there are no other facilities in Ghana that offer this service, making these two facilities the only options for patients requiring organ transplantation.

3. **Pediatric surgery and orthopedic surgery**: While the Korle Bu Teaching Hospital and the Komfo Anokye Teaching Hospital have some capacity for these procedures, there are significant gaps in the dependency chain, particularly in the rural areas of the Northern, Upper East, and Upper West regions. For example, the Tamale Teaching Hospital in the Northern Region has limited equipment and personnel to perform pediatric surgery, with only 2 operating theaters and no ICU.

We have moderate confidence in these findings, based on the capability graph for Ghana's healthcare system and the clinical interpretation of facility records. 

An interactive map with 10 markers is ready to visualize the distribution of these facilities and the gaps in healthcare services across Ghana.

**Recommended actions**:

1. **Upgrade infrastructure**: Upgrade the infrastructure of district hospitals in rural areas to include basic equipment like ultrasound machines, X-ray machines, and operating theaters.
2. **Increase workforce**: Increase the number of doctors and nurses in rural areas to address the workforce gap.
3. **Develop referral systems**: Develop referral systems to ensure that patients are directed to facilities that have the necessary equipment and personnel to provide specialized care.
4. **Monitor and evaluate**: Monitor and evaluate the healthcare capabilities of facilities to prevent misrepresentation of services and ensure that patients receive accurate information about the services available.

  Type     : ⚠️ got='specialty_gap_analysis' expected='regional_analysis'
  Answer   : ✅ (2449 chars)
  Cits     : 0 fac / 4 nodes
  Quality  : conf=0.20 | halluc=0.50

[7.6] 'Where is there oversupply of simple procedures vs scarcity of com'

======================================================================
Query      : Where is there oversupply of simple procedures vs scarcity of complex procedures?
Type       : specialty_gap_analysis (moderate)
Plan       : ['sql', 'medical']
Steps      : ["Router → specialty_gap_analysis | sql → ['medical']", "SQL: 0 rows | ['virtue_foundation.ghana.gold_idp_enriched']", 'Medical reasoning: 3017 chars', 'Synthesiser: answer assembled']
Confidence : 0.20 | Halluc risk: 0.50
Citations  : 0 fac | 4 nodes
MLflow     : 89535efef7184fad89ea63af643c2452
======================================================================

Answer:
Based on our analysis of Ghana's healthcare system, we have identified regions with an oversupply of simple procedures and a scarcity of complex procedures. 

7 of 17 regions in Ghana lack adequate access to complex procedures, with the Northern Region and the Upper East Region being the most affected. According to facility records, the Korle Bu Teaching Hospital in Accra and the Komfo Anokye Teaching Hospital in Kumasi have a higher concentration of complex procedures, whereas smaller district hospitals like the Cape Coast Hospital and the Tamale Teaching Hospital have a higher proportion of simple procedures.

Our capability graph findings reveal a missing link between primary healthcare facilities and tertiary care centers, resulting in an uneven distribution of healthcare resources. Many district hospitals, such as the Bolgatanga Regional Hospital, lack the necessary equipment and trained personnel to perform complex procedures.

The workforce and infrastructure gaps in the Northern Region and the Upper East Region exacerbate the scarcity of complex procedures. For instance, the Upper East Region has only 1.4 doctors per 100,000 people, compared to the national average of 2.5 doctors per 100,000 people.

We have moderate confidence (70%) that some facilities, such as the Sunyani Regional Hospital and the Ho Teaching Hospital, may be at risk of misrepresenting their capabilities, particularly with regards to complex procedures.

An interactive map with 17 markers is ready to visualize the distribution of simple and complex procedures across Ghana's regions.

Recommended actions:

1. **Urgent**: Support the establishment of a telemedicine platform in the Northern Region to connect patients with specialists from major teaching hospitals, addressing the scarcity of complex procedures.
2. **High Priority**: Provide equipment and training to district hospitals in the Upper East Region and the Northern Region to enhance their capacity to perform complex procedures.
3. **Medium Priority**: Collaborate with the Ghana Health Service to develop a referral system that ensures patients are directed to facilities with the necessary capabilities to perform complex procedures.

By addressing these gaps, the Virtue Foundation can help improve access to complex procedures and reduce the oversupply of simple procedures in certain regions.

  Type     : ⚠️ got='specialty_gap_analysis' expected='regional_analysis'
  Answer   : ✅ (2365 chars)
  Cits     : 0 fac / 4 nodes
  Quality  : conf=0.20 | halluc=0.50

[8.1] 'Generate an NGO action plan for the three most underserved region'

======================================================================
Query      : Generate an NGO action plan for the three most underserved regions
Type       : desert_analysis (moderate)
Plan       : ['desert', 'priority', 'medical']
Steps      : ["Router → desert_analysis | desert → ['priority', 'medical']", 'Desert: 17 regions | 2 Severe | 2 cold spots', 'Priority: 17 regions | P1=0 P2=14', 'Medical reasoning: 3885 chars', 'Synthesiser: answer assembled']
Confidence : 0.90 | Halluc risk: 0.30
Citations  : 0 fac | 5 nodes
MLflow     : 5b068f5208a14a57a906c94f34617205
======================================================================

Answer:
**NGO Action Plan for the Three Most Underserved Regions**

Based on the analysis of the medical desert scores, 3 of 17 regions are identified as the most underserved, with severe medical desert scores. The top three regions are:

1. **Savannah region**: With a medical desert score of 0.8736, indicating a significant lack of healthcare facilities and services. According to facility records, the Savannah region has 0 ICU facilities, 0 surgery facilities, and 0 obstetrics facilities, with a total of 0 doctors and 0 beds.
2. **Upper East region**: With a medical desert score of 0.8357, indicating a severe shortage of healthcare facilities and services. The region lacks critical specialties such as emergency medicine, general surgery, and gynecology and obstetrics.
3. **Another region (not specified)**: With a medical desert score of (not specified), indicating a significant lack of healthcare facilities and services.

**Recommended Actions:**

For the Savannah region:

1. **URGENT: Deploy emergency medicine capacity** — zero coverage detected
2. **URGENT: No surgical capacity** — patients cannot receive operative care
3. **URGENT: No obstetrics** — elevated maternal mortality risk
4. **HIGH: Deploy pediatric care** — children's health services absent
5. **URGENT: Critical physician shortage** — avg < 1 doctor per facility

For the Upper East region:

1. **URGENT: Deploy emergency medicine capacity** — zero coverage detected
2. **URGENT: No surgical capacity** — patients cannot receive operative care
3. **URGENT: No obstetrics** — elevated maternal mortality risk

**Regional Priorities:**

1. **Strengthen emergency stabilization, ambulance routing, and triage** — critical infrastructure gap
2. **Perform targeted operational verification of flagged facilities** — ensure facility functionality
3. **Deploy diagnostic, surgical, and emergency equipment** — critical infrastructure gap
4. **Deploy rotating clinicians and specialist outreach** — urgent workforce shortage
5. **Consider NGO mobile outreach and rotating specialist deployment programs** — address workforce shortage

**Confidence Level:**
The confidence level for these recommendations is moderate (0.5786) due to the severity of the medical desert scores and the significant gaps in healthcare services.

**Interactive Map:**
An interactive map with 3 markers is ready to visualize the locations of the most underserved regions and the recommended actions.

**Next Steps:**

1. Conduct further analysis to identify the third most underserved region and its specific needs.
2. Develop a detailed implementation plan for the recommended actions, including timelines, budgets, and resource allocation.
3. Engage with local stakeholders, including healthcare providers, community leaders, and government officials, to ensure the effectiveness and sustainability of the interventions.

  Type     : ⚠️ got='desert_analysis' expected='healthcare_planning'
  Answer   : ✅ (2868 chars)
  Cits     : 0 fac / 5 nodes
  Quality  : conf=0.90 | halluc=0.30

========================================================================
RESULT: 24/24 answered (100%)
========================================================================
Evaluation logged to MLflow ✅
```

---

### 🐍 Supporting IDP Helper Modules

| Module | Role |
|:---|:---|
| [`organization_extraction.py`](databricks/notebooks/organization_extraction.py) | LLM prompts + Pydantic models for entity classification (Facility / NGO / Other) |
| [`facility_and_ngo_fields.py`](databricks/notebooks/facility_and_ngo_fields.py) | `FieldSpec` registry defining extraction prompts for 50+ facility/NGO attributes |
| [`free_form.py`](databricks/notebooks/free_form.py) | Parsers for raw clinical narratives, free-text paragraphs, and on-the-ground field notes |
| [`medical_specialties.py`](databricks/notebooks/medical_specialties.py) | Procedure-to-specialty ontology mapper covering 30+ specialty codes |

---

## ⚙️ `backend/` — Deep Dive

The FastAPI backend acts as the intelligence layer between the Databricks data platform and the React frontend. It operates in **Hybrid Live + Fallback mode** — using Databricks when available, and automatically switching to local FAISS and CSV datasets when offline.

---

### 📁 Root Configuration Files

| File | Role | Description |
|:---|:---|:---|
| [`main.py`](backend/main.py) | **Entry bootstrapper** | Appends `app/` to Python path and launches the Uvicorn ASGI server |
| [`Dockerfile`](backend/Dockerfile) | **Container config** | Multi-stage Docker image for production deployment |
| [`app.yaml`](backend/app.yaml) | **GCP/Render deploy config** | Host, port, environment variable bindings for cloud VM hosting |
| [`render.yaml`](backend/render.yaml) | **Render.com deploy** | Service configuration for Render free-tier backend hosting |
| [`requirements.txt`](backend/requirements.txt) | **Dependencies** | All Python dependencies: `fastapi`, `langgraph`, `databricks-sql-connector`, `faiss-cpu`, `redis`, `structlog`, and more |
| [`.env.example`](backend/.env.example) | **Config template** | Template for all required environment variables with inline documentation |

---

### 📁 `backend/app/` — FastAPI Application Core

#### [`app/main.py`](backend/app/main.py)
- Initializes the FastAPI application instance.
- Configures CORS middleware to allow requests from the React frontend (Vercel + localhost).
- Registers all API routers under versioned path prefixes.
- Hooks `startup` and `shutdown` lifecycle events that initialize Databricks connections, load FAISS indexes, and warm Redis caches.

---

### 📁 `backend/app/core/` — Configuration & Database

| File | Role | Description |
|:---|:---|:---|
| [`core/config.py`](backend/app/core/config.py) | **Settings loader** | Reads all environment variables using Pydantic `BaseSettings`; provides typed config objects for Databricks tokens, FAISS paths, Redis URLs, CORS origins, and model endpoints |
| [`core/database.py`](backend/app/core/database.py) | **SQLite init** | Initializes a local SQLite database for persistent session and chat history storage when Redis is unavailable |

---

### 📁 `backend/app/api/` — REST API Routers

Each file registers one or more FastAPI router endpoints exposed to the React frontend:

| File | Endpoint(s) | Description |
|:---|:---|:---|
| [`api/agent.py`](backend/app/api/agent.py) | `POST /api/v1/agent/query` | **Primary AI chat endpoint.** Accepts natural-language queries and streams responses via Server-Sent Events (SSE). Each SSE event represents one reasoning step: intent classification, SQL execution, RAG retrieval, or synthesized answer with citations. |
| [`api/facilities.py`](backend/app/api/facilities.py) | `GET /api/v1/facilities` | Returns geocoded facility list with coordinates, facility type, operator, region, and clinical capability metadata for Leaflet map rendering. |
| [`api/regions.py`](backend/app/api/regions.py) | `GET /api/v1/regions/summary` `GET /api/v1/regions/desert-scores` | Serves region polygon shapes and computed MDS values for choropleth heatmap rendering. |
| [`api/anomalies.py`](backend/app/api/anomalies.py) | `GET /api/v1/anomalies` | Returns flagged data inconsistencies from `gold_anomaly_flags` with severity labels and source attribution. |
| [`api/exports.py`](backend/app/api/exports.py) | `GET /api/v1/exports/facilities` | Streams analytical results as downloadable CSV documents. |
| [`api/health.py`](backend/app/api/health.py) | `GET /health` | Returns Databricks warehouse status, FAISS index load status, Redis connectivity, and SQL health check results. |

---

### 📁 `backend/app/agents/` — LangGraph AI Orchestrator

This is the intelligence core of the platform — a compiled **14-node LangGraph StateGraph**:

| File | Role | Description |
|:---|:---|:---|
| [`agents/graph.py`](backend/app/agents/graph.py) | **Graph compiler** | Registers all 14 nodes, defines conditional routing edges (`_route_after_router`, `_route_after_sql`, `_route_after_rag`), sets the entry point to `router`, and compiles the stateful `VIRTUE_AGENT` at module startup. |
| [`agents/state.py`](backend/app/agents/state.py) | **State schema** | Defines the `AgentState` TypedDict carrying the full conversation context across nodes: `query`, `chat_history`, `sub_agents`, `sql_results`, `rag_results`, `geo_results`, `anomaly_results`, `desert_results`, `answer`, `citations`, `step_citations`, `errors`, and more. |
| [`agents/nodes.py`](backend/app/agents/nodes.py) | **Node implementations** | The largest file in the project (61KB). Contains Python functions for all 14 agent nodes: SQL generation and execution, FAISS/Vector Search retrieval, Haversine geo calculations, anomaly lookups, desert score interpretation, NGO gap analysis, workforce analysis, and the final synthesiser that builds the structured response. |
| [`agents/prompts.py`](backend/app/agents/prompts.py) | **System prompts** | 40KB of carefully engineered prompt templates: router classification prompt, SQL generation system prompt with schema injection, RAG synthesis instructions, clinical reasoning guidelines, planning frameworks, and error recovery instructions. |
| [`agents/web_search.py`](backend/app/agents/web_search.py) | **Web search node** | Implements the `web_search_node` that queries public web sources (WHO guidelines, disease statistics) when the user enables the web toggle. |
| [`agents/utils.py`](backend/app/agents/utils.py) | **Shared utilities** | Helper functions for text cleaning, string truncation, result formatting, and safe JSON parsing used across multiple node implementations. |

---

### 📁 `backend/app/services/` — Integration Services

| File | Role | Description |
|:---|:---|:---|
| [`services/agent_service.py`](backend/app/services/agent_service.py) | **SSE orchestrator** | Bridges FastAPI and LangGraph. Runs the compiled graph in a background `ThreadPoolExecutor` thread to prevent blocking the async event loop. Transforms each graph state update into structured SSE events (`step`, `answer`, `citations`, `error`) streamed to the frontend. |
| [`services/sql_service.py`](backend/app/services/sql_service.py) | **Databricks SQL connector** | The largest service file (41KB). Manages connection pooling to the Databricks SQL Warehouse via `databricks-sql-connector`. Implements: Redis query result caching with configurable TTL, SQL safety validation (blocks all DDL/DML keywords: `DROP`, `DELETE`, `ALTER`, `TRUNCATE`, `CREATE`, `INSERT`, `UPDATE`), and async-safe query execution with retry logic. |
| [`services/faiss_service.py`](backend/app/services/faiss_service.py) | **FAISS fallback manager** | Loads and manages the local FAISS vector index (`faiss_index.bin`) and metadata (`faiss_metadata.json`). Implements multi-tier embedding fallback: tries OpenAI-compatible payload first, then reformats to MLflow dataframe records if rejected. Queries the FAISS index for nearest-neighbor document retrieval with configurable `top_k`. |
| [`services/cache_service.py`](backend/app/services/cache_service.py) | **Redis wrapper** | Async-safe Redis client with connection health checking, TTL management, key namespacing, JSON serialization/deserialization, and graceful fallback to in-memory dict if Redis is unavailable. |
| [`services/chat_history_service.py`](backend/app/services/chat_history_service.py) | **Conversation memory** | Stores and retrieves multi-turn conversation logs by `session_id`. Supports Redis-backed persistence with SQLite fallback for offline mode. |

---

## 🤖 LangGraph 14-Node Agent

The conversational agent is a compiled **LangGraph StateGraph** that routes every query through exactly the right combination of nodes.

```
User Query
    │
    ▼
┌─────────┐
│  router │ ──── classifies intent ────────────────────────────────────────┐
└─────────┘                                                                 │
    │                                                                       │
    ├──► sql_query         (SQL gen + Databricks Warehouse execution)       │
    ├──► rag_search         (Databricks Vector Search / FAISS fallback)     │
    ├──► geo_calc           (Haversine proximity radius filter)             │
    ├──► anomaly_check      (gold_anomaly_flags retrieval)                  │
    ├──► desert_check       (MDS fetch + regional interpretation)           │
    ├──► medical_reason     (Clinical gap analysis + risk narrative)        │
    ├──► planning_sys       (NGO intervention plan drafting)                │
    ├──► ngo_search         (NGO registry + coverage gap mapping)           │
    ├──► workforce_analysis (Doctor/nurse/specialist distribution)          │
    ├──► resource_check     (Scarce procedures, single-point-of-failure)    │
    ├──► validation_check   (Equipment vs. staffing cross-check)            │
    └──► web_search         (WHO guidelines + external public data)         │
                                                                            │
                        All dispatched nodes complete                       │
                                 │                                          │
                                 ▼                                          │
                          ┌────────────┐ ◄──────────────────────────────── ┘
                          │ synthesiser│  merges outputs + builds citations
                          └─────┬──────┘  + confidence scores + SQL trace
                                │
                                ▼ SSE stream
                          FINAL ANSWER
```

### Full Node Reference

| Node | Role | Responsibility |
|:---|:---|:---|
| `router` | Entry Point | Classifies intent; builds ordered dispatch list (1–3 nodes) |
| `sql_query` | SQL Generator | Generates safe read-only SQL, validates, executes on Databricks SQL Warehouse |
| `rag_search` | Vector Search | Queries Databricks Vector Search or FAISS fallback for document passages |
| `geo_calc` | Geo Proximity | Haversine distance filtering for facilities within radius of a named location |
| `anomaly_check` | Anomaly Audit | Retrieves flagged data inconsistencies and evaluates severity |
| `desert_check` | Desert Scorer | Fetches and interprets Medical Desert Scores for queried regions |
| `medical_reason` | Clinical Reasoning | Clinical analysis of healthcare needs and specialist gaps |
| `planning_sys` | Action Planner | Drafts NGO intervention plans and specialist deployment recommendations |
| `ngo_search` | NGO Mapper | Finds NGOs operating in regions; identifies coverage gaps |
| `workforce_analysis` | Staff Analyser | Analyses doctor, nurse, and specialist workforce distribution |
| `resource_check` | Resource Auditor | Identifies scarce procedures and single-point-of-failure facilities |
| `validation_check` | Data Validator | Cross-checks equipment claims against staffing and infrastructure |
| `web_search` | External Search | Fetches WHO guidelines and public data to supplement internal datasets |
| `synthesiser` | Response Builder | Merges all node outputs into a single answer with citations and confidence scores |

---

## 💬 Sample Agent Queries

> **"Which region in Ghana has the fewest doctors per capita?"**
> ```
> → router → sql_query → synthesiser
> → Savannah (0.00 doctors/100k) — recommended actions: deploy 3 GPs, 1 surgeon
> ```

> **"Find all clinics within 50km of Kumasi with surgical capability"**
> ```
> → router → geo_calc + rag_search → synthesiser
> → 7 facilities matched · sorted by distance · confidence scores attached
> ```

> **"Which facilities report ICU beds but have zero doctors?"**
> ```
> → router → sql_query + anomaly_check → synthesiser
> → 12 flagged records from gold_anomaly_flags · severity: CRITICAL
> ```

> **"What is the maternal mortality risk in Upper East region?"**
> ```
> → router → desert_check + medical_reason → synthesiser
> → MDS obstetrics gap: 0.84 · narrative: high-risk, 0 OB/GYN specialists within region
> ```

> **"Which NGOs are active in Savannah and what gaps remain?"**
> ```
> → router → ngo_search + rag_search → synthesiser
> → 2 NGOs matched · 4 specialty gaps identified · intervention plan drafted
> ```

---

## 🖥️ Dashboard Pages

| Page | Icon | File | Description |
|:---|:---:|:---|:---|
| Dashboard | 📊 | `Dashboard.tsx` | Live KPI counters: facilities, hospitals, NGO partners, average MDS, critical desert counts |
| Map Explorer | 🗺️ | `MapExplorer.tsx` | Leaflet map with desert heatmaps, facility markers, regional boundaries, and detail popups |
| Desert Analysis | 🌵 | `DesertAnalysis.tsx` | Regional MDS rankings, specialty gap breakdowns, bed/doctor ratio charts, intervention actions |
| Anomaly Report | ⚠️ | `AnomalyReport.tsx` | Data integrity flags sorted by severity, with inconsistency detail and source attribution |
| AI Agent | 🤖 | `ChatAgent.tsx` | Real-time streaming chat: step-by-step reasoning, SQL display, citations, confidence scores |
| Facility Explorer | 🏥 | `FacilityExplorer.tsx` | Searchable, filterable registry of 900+ facilities with capability badges and geo metadata |

---

## 📐 Tech Stack

<div align="center">

| Layer | Technology | Purpose |
|:---|:---:|:---|
| **Data Engineering** | ![Databricks](https://img.shields.io/badge/Databricks-FF3621?style=flat-square&logo=databricks) | Medallion pipeline, Unity Catalog, Delta Lake |
| **LLM Extraction** | ![Llama](https://img.shields.io/badge/Llama--3_70B-0467DF?style=flat-square) | IDP entity & fact extraction via `ai_query` |
| **Vector Search** | ![FAISS](https://img.shields.io/badge/FAISS_%2F_Databricks_VS-blue?style=flat-square) | Semantic RAG retrieval with offline fallback |
| **Agent Orchestration** | ![LangGraph](https://img.shields.io/badge/LangGraph-1C3C3C?style=flat-square&logo=langchain) | 14-node stateful agent state machine |
| **Backend API** | ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi) | SSE streaming, REST endpoints, Redis caching |
| **Frontend** | ![React](https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black) | Vite + TypeScript dashboard |
| **Maps** | ![Leaflet](https://img.shields.io/badge/Leaflet.js-199900?style=flat-square&logo=leaflet) | Interactive geospatial heatmaps |
| **Caching** | ![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white) | Query result caching, TTL management |
| **Deployment** | ![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel) + ![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker) | Frontend CDN + Backend containerization |

</div>

---

## ⚡ Quickstart

### Prerequisites
- Python 3.11+ · Node.js 18+ · Git

### Backend

```bash
git clone https://github.com/your-username/virtue-foundation-ghana.git
cd virtue-foundation-ghana/backend

cp .env.example .env          # fill in Databricks credentials
python -m venv .venv
source .venv/bin/activate     # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000
# API running at http://localhost:8000
# Health check: http://localhost:8000/health
```

### Frontend

```bash
cd ../frontend
npm install
npm run dev
# Dashboard at http://localhost:5173
```

### Docker (Full Stack)

```bash
cd backend
docker build -t virtue-backend .
docker run -p 8000:8000 --env-file .env virtue-backend
```

### Databricks Asset Bundle (DAB)

```bash
pip install databricks-cli
databricks configure --token

# Deploy to dev
databricks bundle deploy --target dev
databricks bundle run virtue_foundation_idp --target dev

# Deploy to production
databricks bundle deploy --target prod
databricks bundle run virtue_foundation_idp --target prod
```

| Target | App Name | Workspace |
|:---|:---|:---|
| `dev` | `virtue-foundation-idp-dev` | `https://dbc-147ceb0b-b41d.cloud.databricks.com` |
| `prod` | `virtue-foundation-idp` | Same workspace — production mode enabled |

---

## ⚙️ Environment Variables

```env
# Databricks Connection
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=dapiXXXXXXXXXXXXXXXX
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/your-warehouse-id
DATABRICKS_CATALOG=virtue_foundation
DATABRICKS_SCHEMA=ghana

# Databricks Model Serving
LLM_ENDPOINT=databricks-meta-llama-3-3-70b-instruct
EMBED_ENDPOINT=databricks-bge-large-en

# Application
SECRET_KEY=your-secret-key-here
CORS_ORIGINS=https://your-frontend.vercel.app,http://localhost:5173

# Optional: Redis Caching
REDIS_URL=redis://localhost:6379

# Optional: FAISS Fallback
FAISS_INDEX_URL=https://your-storage.com/faiss_index.bin
FAISS_META_URL=https://your-storage.com/faiss_metadata.json

# Optional: MLflow Tracing
MLFLOW_TRACKING_URI=databricks
```

> 🔒 **Security:** Never commit real tokens. Use platform secret management in production. Rotate any exposed credentials immediately.

---

## 🔐 Security & Governance

### Unity Catalog Governance
- Row-level and column-level access controls
- Dataset lineage tracking
- Secure Delta Sharing

### Secure Query Execution
- Read-only SQL validation
- Blocks all DDL/DML operations
- Parameterized query enforcement

### Infrastructure Security
- Environment-variable secret management
- Token-based Databricks authentication
- Redis connection isolation
- CORS-restricted API access

### Healthcare Data Safety
- No patient PII stored
- Synthetic/anonymized datasets only
- Secure in-platform AI extraction using Databricks Foundation Models

---

## 🩺 API Reference

<div align="center">

| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/health` | Databricks + FAISS connectivity status |
| `GET` | `/api/v1/regions/summary` | Region-level summary metrics |
| `GET` | `/api/v1/facilities` | Geocoded facility list with coordinates |
| `GET` | `/api/v1/regions/desert-scores` | Medical Desert Scores per region |
| `GET` | `/api/v1/anomalies` | Data integrity anomaly flags |
| `POST` | `/api/v1/agent/query` | SSE-streaming natural language agent query |
| `GET` | `/api/v1/exports/facilities` | Download facilities as CSV |

</div>

---

## 🏗️ Project Structure

```
virtue-foundation-ghana/
│
├── databricks/
│   └── notebooks/                  # Medallion ETL · IDP · RAG · Scoring
│       ├── 01_ingest_bronze_v2.ipynb       ← Raw CSV/GeoJSON/text ingestion
│       ├── 02_transform_silver.ipynb       ← Dedup, standardize, geo-parse
│       ├── 03_build_gold.ipynb             ← Geospatial join with boundaries
│       ├── 04_idp_agent.ipynb              ← 15-phase Llama-3 IDP extraction
│       ├── 05_rag_build_index.ipynb        ← Embed + sync VS index + FAISS
│       ├── 06_langgraph_agent.ipynb        ← Agent prototype sandbox
│       ├── 07_medical_desert_scoring.ipynb ← MDS v12 composite scoring
│       ├── 08_anomaly_detection_v2.ipynb   ← Clinical plausibility audit
│       ├── organization_extraction.py      ← Entity classification prompts
│       ├── facility_and_ngo_fields.py      ← FieldSpec extraction registry
│       ├── free_form.py                    ← Narrative parser
│       └── medical_specialties.py          ← Procedure-to-specialty mapper
│
├── backend/                        # FastAPI application
│   ├── app/
│   │   ├── api/                    # Route handlers
│   │   │   ├── agent.py            ← SSE agent query endpoint
│   │   │   ├── facilities.py       ← Geocoded facility data
│   │   │   ├── regions.py          ← MDS + polygon data
│   │   │   ├── anomalies.py        ← Data integrity flags
│   │   │   ├── exports.py          ← CSV download
│   │   │   └── health.py           ← System status
│   │   ├── agents/                 # LangGraph orchestrator
│   │   │   ├── graph.py            ← 14-node StateGraph compiler
│   │   │   ├── nodes.py            ← All node implementations (61KB)
│   │   │   ├── state.py            ← AgentState TypedDict schema
│   │   │   ├── prompts.py          ← System prompt library (40KB)
│   │   │   ├── web_search.py       ← External search node
│   │   │   └── utils.py            ← Shared helpers
│   │   ├── services/               # External integrations
│   │   │   ├── agent_service.py    ← FastAPI ↔ LangGraph SSE bridge
│   │   │   ├── sql_service.py      ← Databricks SQL Warehouse (41KB)
│   │   │   ├── faiss_service.py    ← FAISS fallback manager
│   │   │   ├── cache_service.py    ← Redis wrapper
│   │   │   └── chat_history_service.py ← Conversation memory
│   │   └── core/
│   │       ├── config.py           ← Pydantic Settings loader
│   │       └── database.py         ← SQLite init for offline mode
│   ├── rag_data/                   ← faiss_index.bin + faiss_metadata.json
│   ├── static/                     ← Static assets
│   ├── tests/                      ← Backend test suite
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py
│
├── frontend/                       # React SPA (Vite + TypeScript)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx       ← KPI counters + region charts
│   │   │   ├── MapExplorer.tsx     ← Leaflet heatmap + facility markers
│   │   │   ├── ChatAgent.tsx       ← SSE streaming agent chat
│   │   │   ├── FacilityExplorer.tsx← Searchable facility registry
│   │   │   ├── DesertAnalysis.tsx  ← MDS ranking + specialty gaps
│   │   │   └── AnomalyReport.tsx   ← Data integrity flags
│   │   └── api/
│   │       └── client.ts           ← Unified fetch wrappers + SSE consumer
│   └── public/                     ← GIFs, screenshots, favicon
│
└── databricks.yml                  ← Asset Bundle config (dev + prod)
```

---

## 🏆 Hackathon Evaluation Alignment

| Criterion | How This Project Delivers |
|:---|:---|
| **Technical Innovation** | LLM-powered IDP with 15-phase extraction using Databricks `ai_query` natively in Delta tables |
| **Databricks Platform Depth** | Unity Catalog · Delta Lake Medallion · Vector Search · Model Serving · SQL Warehouse · DAB deployment |
| **Social Impact** | Directly addresses WHO SDG 3 (health equity) by identifying medical deserts and enabling NGO resource allocation |
| **Data Quality** | Automated anomaly detection engine flags 340+ contradictions across 900+ facilities |
| **UX & Accessibility** | Natural-language agent enables non-technical planners to query complex datasets without SQL knowledge |
| **Production Readiness** | Docker · Redis caching · FAISS offline fallback · SSE streaming · DAB multi-environment deployment |

---

## 🌍 Real-World Healthcare Impact

This platform directly supports:
- NGO intervention planning
- Rural healthcare accessibility analysis
- Clinical workforce allocation
- Medical infrastructure auditing
- Regional vulnerability assessment
- Public health intelligence operations

Potential deployment scenarios include:
- Ministry of Health planning
- WHO regional healthcare analytics
- Emergency response coordination
- Rural maternal healthcare outreach
- NGO funding prioritization

---

## 🗺️ Roadmap

- [ ] MLflow trace links per agent sub-step for full observability
- [ ] Automated extraction accuracy tests + end-to-end SSE stream tests
- [ ] Expanded map overlays: population density, road access index
- [ ] Multi-country support beyond Ghana
- [ ] Fine-tuned embedding model for clinical terminology
- [ ] Mobile-responsive PWA for field NGO workers

---

## 🛡️ License & IP Compliance

<details>
<summary><b>View full license table</b></summary>

| Component | License |
|:---|:---|
| FastAPI | MIT License |
| LangGraph | MIT License |
| Databricks SQL Connector | Apache License 2.0 |
| FAISS | MIT License |
| React & Vite | MIT License |
| Leaflet.js | BSD 2-Clause License |
| Meta Llama-3 (via Databricks serving) | Meta Llama 3 Community License |
| GeoJSON boundary data | Public domain / CC-BY (humanitarian open data) |
| Facility records & NGO profiles | Synthetic / anonymized — zero PII |

All pipeline notebooks, scoring algorithms, LangGraph node logic, FastAPI services, and React UI components were authored specifically for this hackathon submission and are free of copyright infringement.

</details>

---

## 🤝 Acknowledgements

<div align="center">

Built with ❤️ for the **Databricks × Accenture Hackathon 2025**

| | |
|:---:|:---|
| 🏥 | **Virtue Foundation** — for the vision, mission, and data |
| ⚡ | **Databricks** — for the Data Intelligence Platform powering this solution |
| 🤝 | **Accenture** — for the hackathon track and challenge framing |
| 🌍 | **Open Source Community** — React · FastAPI · Leaflet · FAISS · LangGraph |

</div>

---

<div align="center">

**Built with purpose for the Databricks × Accenture Virtue Foundation Hackathon**

*Making healthcare access visible — one data point at a time.* 🇬🇭

[![Live Demo](https://img.shields.io/badge/🚀_Live_Demo-virtue--foundation--ghana--dd.vercel.app-0369a1?style=for-the-badge)](https://virtue-foundation-ghana-dd.vercel.app)

</div>
