# ============================================================================
# AGENT MODULE - SINGLETON PATTERN
# ============================================================================
# Provides a singleton agent instance for FastAPI to avoid recreating on each request

import os
import json
from typing import List, Dict, Any
from databricks.vector_search.client import VectorSearchClient
from databricks.sql import connect

# LangChain imports
try:
    from langchain.agents import AgentExecutor, create_react_agent
    from langchain.tools import Tool
    from langchain_core.prompts import PromptTemplate
    from langchain_community.chat_models import ChatDatabricks
except ImportError:
    raise ImportError("LangChain packages not installed. Run: pip install langchain langchain-community databricks-langchain")

CATALOG = "vf_health"
SCHEMA = "ghana"

# Global agent instance (singleton)
_agent_executor = None
_vs_client = None
_vs_index = None

# ============================================================================
# TOOL IMPLEMENTATIONS
# ============================================================================

def _get_vs_index():
    """Get or create vector search index."""
    global _vs_client, _vs_index
    
    if _vs_index is None:
        _vs_client = VectorSearchClient(disable_notice=True)
        _vs_index = _vs_client.get_index(f"{CATALOG}.{SCHEMA}.facility_rag_index")
    
    return _vs_index

def _execute_sql(query: str) -> List[Dict[str, Any]]:
    """Execute SQL query against Databricks."""
    host = os.getenv("DATABRICKS_HOST")
    token = os.getenv("DATABRICKS_TOKEN")
    warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID")
    
    with connect(
        server_hostname=host,
        http_path=f"/sql/1.0/warehouses/{warehouse_id}",
        access_token=token
    ) as conn:
        with conn.cursor() as cursor:
            cursor.execute(query)
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            return [dict(zip(columns, row)) for row in rows]

def search_facilities_fn(query: str) -> str:
    """Search for healthcare facilities using semantic similarity."""
    try:
        vs_index = _get_vs_index()
        results = vs_index.similarity_search(
            query_text=query,
            columns=["name", "address_region_clean", "address_city", 
                     "facilityTypeId", "capability_score",
                     "has_emergency", "has_surgery", "has_imaging",
                     "numberDoctors", "capacity", "source_url"],
            num_results=5
        )
        
        if results and 'result' in results and 'data_array' in results['result']:
            data = results['result']['data_array']
            
            facilities = []
            for row in data:
                facility = {
                    "name": row[0],
                    "region": row[1],
                    "city": row[2],
                    "type": row[3],
                    "capability_score": row[4],
                    "has_emergency": row[5],
                    "has_surgery": row[6],
                    "has_imaging": row[7],
                    "doctors": row[8],
                    "beds": row[9],
                    "citation": {
                        "source_table": f"{CATALOG}.{SCHEMA}.gold_facility_cards",
                        "source_url": row[10],
                        "facility_name": row[0]
                    }
                }
                facilities.append(facility)
            
            return json.dumps({
                "query": query,
                "results_count": len(facilities),
                "facilities": facilities
            }, indent=2)
        else:
            return json.dumps({"error": "No results found", "query": query})
    except Exception as e:
        return json.dumps({"error": str(e), "query": query})

def get_region_gap_analysis_fn(region: str = "") -> str:
    """Get regional gap analysis."""
    try:
        query = f"""
        SELECT 
            address_region_clean,
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
            gap_severity
        FROM {CATALOG}.{SCHEMA}.gold_region_summary
        """
        
        if region:
            query += f" WHERE LOWER(address_region_clean) LIKE LOWER('%{region}%')"
        
        query += " ORDER BY desert_pct DESC LIMIT 20"
        
        results = _execute_sql(query)
        
        regions = []
        for row in results:
            region_data = dict(row)
            region_data["citation"] = {
                "source_table": f"{CATALOG}.{SCHEMA}.gold_region_summary",
                "region_name": row["address_region_clean"]
            }
            regions.append(region_data)
        
        return json.dumps({
            "filter": region if region else "all_regions",
            "results_count": len(regions),
            "regions": regions
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e), "region_filter": region})

def find_medical_deserts_fn() -> str:
    """Find medical desert regions."""
    try:
        query = f"""
        SELECT 
            address_region_clean,
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
        ORDER BY desert_pct DESC
        """
        
        results = _execute_sql(query)
        
        deserts = []
        for row in results:
            desert = dict(row)
            desert["citation"] = {
                "source_table": f"{CATALOG}.{SCHEMA}.gold_region_summary",
                "severity_threshold": "Critical or High",
                "region_name": row["address_region_clean"]
            }
            deserts.append(desert)
        
        return json.dumps({
            "medical_deserts_count": len(deserts),
            "regions": deserts
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})

def get_facility_detail_fn(facility_name: str) -> str:
    """Get detailed facility information."""
    try:
        query = f"""
        SELECT 
            name, organization_type, facilityTypeId, operatorTypeId,
            address_city, address_region_clean, address_country,
            specialties, procedure, equipment, capability,
            numberDoctors, capacity, area, yearEstablished,
            has_emergency, has_surgery, has_imaging,
            capability_score, is_medical_desert_risk,
            phone_numbers, email, officialWebsite,
            description, source_url
        FROM {CATALOG}.{SCHEMA}.gold_facility_cards
        WHERE LOWER(name) LIKE LOWER('%{facility_name}%')
        LIMIT 3
        """
        
        results = _execute_sql(query)
        
        if not results:
            return json.dumps({"error": "Facility not found", "searched_name": facility_name})
        
        facilities = []
        for row in results:
            facility = dict(row)
            facility["citation"] = {
                "source_table": f"{CATALOG}.{SCHEMA}.gold_facility_cards",
                "facility_name": row["name"]
            }
            facilities.append(facility)
        
        return json.dumps({
            "search_query": facility_name,
            "results_count": len(facilities),
            "facilities": facilities
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e), "facility_name": facility_name})

# ============================================================================
# AGENT INITIALIZATION
# ============================================================================

def _initialize_agent():
    """Initialize the LangChain agent with tools."""
    
    # Define tools
    tools = [
        Tool(
            name="search_facilities",
            func=search_facilities_fn,
            description="Search for healthcare facilities using natural language. Input: search query string."
        ),
        Tool(
            name="get_region_gap_analysis",
            func=get_region_gap_analysis_fn,
            description="Get regional gap analysis. Input: region name or empty string for all regions."
        ),
        Tool(
            name="find_medical_deserts",
            func=find_medical_deserts_fn,
            description="Find medical desert regions with Critical or High severity. Input: none (empty string)."
        ),
        Tool(
            name="get_facility_detail",
            func=get_facility_detail_fn,
            description="Get detailed facility information by name. Input: facility name string."
        )
    ]
    
    # System prompt
    system_prompt = """You are a healthcare intelligence analyst for the Virtue Foundation working in Ghana.

Your mission is to identify medical deserts, analyze facility capabilities, and guide resource allocation.

You have access to these tools:
{tools}

Tool Names: {tool_names}

Always cite your sources and be precise with numbers.

Use this format:

Question: the input question
Thought: think about what information you need
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
... (repeat as needed)
Thought: I now know the final answer
Final Answer: the final answer with citations

Begin!

Question: {input}
Thought: {agent_scratchpad}
"""
    
    # Create prompt
    prompt = PromptTemplate(
        template=system_prompt,
        input_variables=["input", "agent_scratchpad"],
        partial_variables={
            "tools": "\n".join([f"{tool.name}: {tool.description}" for tool in tools]),
            "tool_names": ", ".join([tool.name for tool in tools])
        }
    )
    
    # Initialize LLM
    llm = ChatDatabricks(
        endpoint="databricks-meta-llama-3-3-70b-instruct",
        temperature=0.1,
        max_tokens=2000
    )
    
    # Create agent
    agent = create_react_agent(llm=llm, tools=tools, prompt=prompt)
    
    # Create executor
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        handle_parsing_errors=True,
        max_iterations=10,
        max_execution_time=120
    )
    
    return agent_executor

def get_agent() -> AgentExecutor:
    """Get or create the singleton agent instance."""
    global _agent_executor
    
    if _agent_executor is None:
        _agent_executor = _initialize_agent()
    
    return _agent_executor

def extract_citations(intermediate_steps: List) -> List[Dict[str, Any]]:
    """Extract citations from agent intermediate steps."""
    citations = []
    
    for step in intermediate_steps:
        if len(step) < 2:
            continue
        
        tool_name = step[0].tool if hasattr(step[0], 'tool') else "unknown"
        tool_output = step[1] if len(step) > 1 else ""
        
        # Try to parse JSON output for citations
        try:
            output_json = json.loads(tool_output)
            if "citation" in output_json:
                citations.append({
                    "tool": tool_name,
                    "citation": output_json["citation"]
                })
            elif "regions" in output_json:
                for region in output_json.get("regions", []):
                    if "citation" in region:
                        citations.append({
                            "tool": tool_name,
                            "citation": region["citation"]
                        })
            elif "facilities" in output_json:
                for facility in output_json.get("facilities", []):
                    if "citation" in facility:
                        citations.append({
                            "tool": tool_name,
                            "citation": facility["citation"]
                        })
        except:
            pass
    
    return citations