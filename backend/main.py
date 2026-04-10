# ============================================================================
# VIRTUE FOUNDATION GHANA IDP - FASTAPI BACKEND
# ============================================================================
# Production-ready FastAPI backend for healthcare intelligence system

import os
import json
from typing import List, Optional, Dict, Any
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

import databricks.sql as dbsql
import mlflow

# Load environment variables
load_dotenv()

# Initialize FastAPI
app = FastAPI(
    title="VF Health Ghana IDP API",
    description="Healthcare Intelligence API for Ghana - Medical Desert Analysis & Facility Search",
    version="1.0.0"
)

# CORS configuration for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Databricks connection config
DATABRICKS_HOST = os.getenv("DATABRICKS_HOST")
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN")
DATABRICKS_WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID")

CATALOG = "vf_health"
SCHEMA = "ghana"

# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class AgentQuery(BaseModel):
    query: str

class AgentResponse(BaseModel):
    answer: str
    citations: List[Dict[str, Any]]
    tools_used: List[str]
    execution_time_ms: float

# ============================================================================
# DATABASE CONNECTION HELPER
# ============================================================================

def get_db_connection():
    """Create Databricks SQL connection."""
    if not all([DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID]):
        raise HTTPException(
            status_code=500,
            detail="Missing Databricks configuration. Check environment variables."
        )
    
    return dbsql.connect(
        server_hostname=DATABRICKS_HOST,
        http_path=f"/sql/1.0/warehouses/{DATABRICKS_WAREHOUSE_ID}",
        access_token=DATABRICKS_TOKEN
    )

def execute_query(query: str) -> List[Dict[str, Any]]:
    """Execute SQL query and return results as list of dicts."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                columns = [desc[0] for desc in cursor.description]
                rows = cursor.fetchall()
                return [dict(zip(columns, row)) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# ============================================================================
# ENDPOINT 1: GET REGIONS
# ============================================================================

@app.get("/api/regions")
def get_regions():
    """
    Get all regions with medical infrastructure metrics.
    Returns regional gap analysis with citations.
    """
    query = f"""
    SELECT 
        address_region_clean as region,
        total_facilities,
        avg_capability_score,
        medical_desert_count,
        desert_pct,
        facilities_with_emergency,
        facilities_with_surgery,
        facilities_with_imaging,
        total_doctors,
        total_beds,
        doctors_per_facility,
        gap_severity,
        computed_at
    FROM {CATALOG}.{SCHEMA}.gold_region_summary
    ORDER BY desert_pct DESC
    """
    
    results = execute_query(query)
    
    # Add citations to each result
    for result in results:
        result["citation"] = {
            "source_table": f"{CATALOG}.{SCHEMA}.gold_region_summary",
            "aggregated_from": f"{CATALOG}.{SCHEMA}.silver_facilities_clean",
            "computed_at": str(result.get("computed_at", ""))
        }
    
    return {
        "count": len(results),
        "regions": results,
        "metadata": {
            "catalog": CATALOG,
            "schema": SCHEMA,
            "table": "gold_region_summary"
        }
    }

# ============================================================================
# ENDPOINT 2: GET FACILITIES
# ============================================================================

@app.get("/api/facilities")
def get_facilities(
    region: Optional[str] = None,
    has_emergency: Optional[bool] = None,
    has_surgery: Optional[bool] = None,
    min_score: Optional[int] = None,
    limit: int = Query(50, le=200)
):
    """
    Get facilities with optional filters.
    Supports filtering by region, capabilities, and minimum score.
    """
    base_query = f"""
    SELECT 
        name,
        facilityTypeId as facility_type,
        operatorTypeId as operator_type,
        address_city as city,
        address_region_clean as region,
        address_country as country,
        has_emergency,
        has_surgery,
        has_imaging,
        capability_score,
        is_medical_desert_risk,
        numberDoctors as doctors,
        capacity as beds,
        phone_numbers,
        email,
        officialWebsite as website,
        source_url,
        created_at
    FROM {CATALOG}.{SCHEMA}.gold_facility_cards
    WHERE 1=1
    """
    
    # Apply filters
    if region:
        base_query += f" AND LOWER(address_region_clean) LIKE LOWER('%{region}%')"
    if has_emergency is not None:
        base_query += f" AND has_emergency = {has_emergency}"
    if has_surgery is not None:
        base_query += f" AND has_surgery = {has_surgery}"
    if min_score is not None:
        base_query += f" AND capability_score >= {min_score}"
    
    base_query += f" ORDER BY capability_score DESC LIMIT {limit}"
    
    results = execute_query(base_query)
    
    # Add citations
    for result in results:
        result["citation"] = {
            "source_table": f"{CATALOG}.{SCHEMA}.gold_facility_cards",
            "source_url": result.get("source_url", ""),
            "facility_name": result.get("name", "")
        }
    
    return {
        "count": len(results),
        "facilities": results,
        "filters_applied": {
            "region": region,
            "has_emergency": has_emergency,
            "has_surgery": has_surgery,
            "min_score": min_score
        }
    }

# ============================================================================
# ENDPOINT 3: GET MEDICAL DESERTS
# ============================================================================

@app.get("/api/medical-deserts")
def get_medical_deserts():
    """
    Get regions with Critical or High severity medical desert classification.
    Includes list of at-risk facilities in each region.
    """
    # Get desert regions
    regions_query = f"""
    SELECT 
        address_region_clean as region,
        total_facilities,
        avg_capability_score,
        desert_pct,
        gap_severity,
        facilities_with_emergency,
        facilities_with_surgery,
        total_doctors,
        total_beds
    FROM {CATALOG}.{SCHEMA}.gold_region_summary
    WHERE gap_severity IN ('Critical', 'High')
    ORDER BY 
        CASE 
            WHEN gap_severity = 'Critical' THEN 1
            WHEN gap_severity = 'High' THEN 2
        END,
        desert_pct DESC
    """
    
    desert_regions = execute_query(regions_query)
    
    # For each desert region, get at-risk facilities
    for region_data in desert_regions:
        region_name = region_data["region"]
        
        facilities_query = f"""
        SELECT 
            name,
            capability_score,
            has_emergency,
            has_surgery,
            numberDoctors as doctors,
            capacity as beds
        FROM {CATALOG}.{SCHEMA}.gold_facility_cards
        WHERE address_region_clean = '{region_name}'
          AND is_medical_desert_risk = true
        ORDER BY capability_score ASC
        LIMIT 10
        """
        
        at_risk_facilities = execute_query(facilities_query)
        region_data["at_risk_facilities"] = at_risk_facilities
        
        region_data["citation"] = {
            "source_table": f"{CATALOG}.{SCHEMA}.gold_region_summary",
            "severity_threshold": "Critical or High",
            "region_name": region_name
        }
    
    return {
        "medical_deserts_count": len(desert_regions),
        "severity_levels": ["Critical", "High"],
        "regions": desert_regions
    }

# ============================================================================
# ENDPOINT 4: AGENT QUERY
# ============================================================================

@app.post("/api/agent/query", response_model=AgentResponse)
async def agent_query(query: AgentQuery):
    """
    Execute natural language query using the LangChain IDP agent.
    Returns answer with citations and tools used.
    """
    try:
        # Import agent module (lazy load)
        from agent_module import get_agent, extract_citations
        
        start_time = datetime.now()
        
        # Execute agent query
        agent = get_agent()
        response = agent.invoke({"input": query.query})
        
        end_time = datetime.now()
        execution_time_ms = (end_time - start_time).total_seconds() * 1000
        
        # Extract answer and metadata
        answer = response.get("output", "No response generated")
        intermediate_steps = response.get("intermediate_steps", [])
        
        # Extract tools used
        tools_used = [step[0].tool for step in intermediate_steps if len(step) > 0]
        
        # Extract citations from tool outputs
        citations = extract_citations(intermediate_steps)
        
        # Log to MLflow
        with mlflow.start_run(run_name=f"api_query_{datetime.now().strftime('%H%M%S')}"):
            mlflow.log_param("query", query.query)
            mlflow.log_metric("execution_time_ms", execution_time_ms)
            mlflow.log_metric("num_tools_used", len(tools_used))
            mlflow.log_metric("response_length", len(answer))
        
        return AgentResponse(
            answer=answer,
            citations=citations,
            tools_used=tools_used,
            execution_time_ms=execution_time_ms
        )
    
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Agent module not available. Ensure agent is properly initialized."
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Agent execution error: {str(e)}"
        )

# ============================================================================
# ENDPOINT 5: SUMMARY STATISTICS
# ============================================================================

@app.get("/api/stats/summary")
def get_summary_stats():
    """
    Get overall summary statistics for Ghana healthcare system.
    Returns national-level metrics and desert count.
    """
    # Total facilities
    facilities_count = execute_query(f"""
        SELECT COUNT(*) as count 
        FROM {CATALOG}.{SCHEMA}.gold_facility_cards
    """)[0]["count"]
    
    # Total regions
    regions_count = execute_query(f"""
        SELECT COUNT(*) as count 
        FROM {CATALOG}.{SCHEMA}.gold_region_summary
    """)[0]["count"]
    
    # Critical deserts
    critical_deserts = execute_query(f"""
        SELECT COUNT(*) as count 
        FROM {CATALOG}.{SCHEMA}.gold_region_summary
        WHERE gap_severity IN ('Critical', 'High')
    """)[0]["count"]
    
    # National averages
    national_stats = execute_query(f"""
        SELECT 
            AVG(avg_capability_score) as national_avg_score,
            SUM(total_doctors) as total_doctors,
            SUM(total_beds) as total_beds,
            SUM(facilities_with_emergency) as emergency_facilities,
            SUM(facilities_with_surgery) as surgery_facilities
        FROM {CATALOG}.{SCHEMA}.gold_region_summary
    """)[0]
    
    return {
        "total_facilities": facilities_count,
        "total_regions": regions_count,
        "critical_high_deserts": critical_deserts,
        "national_avg_capability_score": round(float(national_stats["national_avg_score"] or 0), 2),
        "total_doctors": national_stats["total_doctors"] or 0,
        "total_beds": national_stats["total_beds"] or 0,
        "facilities_with_emergency": national_stats["emergency_facilities"] or 0,
        "facilities_with_surgery": national_stats["surgery_facilities"] or 0,
        "citation": {
            "source_tables": [
                f"{CATALOG}.{SCHEMA}.gold_facility_cards",
                f"{CATALOG}.{SCHEMA}.gold_region_summary"
            ],
            "computed_at": datetime.now().isoformat()
        }
    }

# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/")
def root():
    return {
        "service": "VF Health Ghana IDP API",
        "version": "1.0.0",
        "status": "operational",
        "endpoints": [
            "/api/regions",
            "/api/facilities",
            "/api/medical-deserts",
            "/api/agent/query",
            "/api/stats/summary"
        ]
    }

@app.get("/health")
def health_check():
    """Health check endpoint."""
    try:
        # Test database connection
        test_query = f"SELECT 1 as test FROM {CATALOG}.{SCHEMA}.gold_facility_cards LIMIT 1"
        execute_query(test_query)
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)