"""
Healthcare AI Agent System - Utilities Module
==============================================
Common utility functions for data processing, validation, and transformations
Author: Databricks Accenture Hackathon Team
"""

import re
import json
import hashlib
from typing import List, Dict, Optional, Any, Tuple
from datetime import datetime
import pyspark.sql.functions as F
from pyspark.sql import DataFrame
from pyspark.sql.types import ArrayType, StringType


# =============================================================================
# DATA VALIDATION UTILITIES
# =============================================================================

def is_valid_email(email: str) -> bool:
    """Validate email address format"""
    if not email:
        return False
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def is_valid_url(url: str) -> bool:
    """Validate URL format"""
    if not url:
        return False
    pattern = r'^https?://[^\s<>"]+|www\.[^\s<>"]+'
    return bool(re.match(pattern, url))


def is_valid_phone_e164(phone: str) -> bool:
    """Validate phone number in E164 format (+233XXXXXXXXX)"""
    if not phone:
        return False
    pattern = r'^\+[1-9]\d{1,14}$'
    return bool(re.match(pattern, phone))


def normalize_phone_number(phone: str, default_country_code: str = "+233") -> Optional[str]:
    """
    Normalize phone number to E164 format
    
    Examples:
        "0201234567" -> "+233201234567"
        "233201234567" -> "+233201234567"
        "+233201234567" -> "+233201234567"
    """
    if not phone:
        return None
    
    # Remove all non-digit characters except leading +
    cleaned = re.sub(r'[^\d+]', '', phone)
    
    # Add + if missing
    if not cleaned.startswith('+'):
        # Remove leading 0 if present
        if cleaned.startswith('0'):
            cleaned = cleaned[1:]
        
        # Add country code if not present
        if not cleaned.startswith('233'):
            cleaned = default_country_code[1:] + cleaned
        
        cleaned = '+' + cleaned
    
    # Validate final format
    if is_valid_phone_e164(cleaned):
        return cleaned
    
    return None


def extract_domain_from_url(url: str) -> Optional[str]:
    """Extract domain name from URL"""
    if not url:
        return None
    
    # Remove protocol
    domain = re.sub(r'^https?://', '', url)
    domain = re.sub(r'^www\.', '', domain)
    
    # Get domain only (remove path)
    domain = domain.split('/')[0]
    
    return domain if domain else None


# =============================================================================
# ADDRESS PARSING UTILITIES
# =============================================================================

def parse_comma_separated_address(address_str: str) -> Dict[str, Optional[str]]:
    """
    Parse comma-separated location string into components
    
    Example:
        "Kumasi, Ashanti Region, Ghana" -> 
        {
            "city": "Kumasi",
            "state_or_region": "Ashanti Region",
            "country": "Ghana"
        }
    """
    if not address_str:
        return {"city": None, "state_or_region": None, "country": None}
    
    parts = [p.strip() for p in address_str.split(',') if p.strip()]
    
    result = {
        "city": None,
        "state_or_region": None,
        "country": None
    }
    
    if len(parts) >= 1:
        result["city"] = parts[0]
    if len(parts) >= 2:
        result["state_or_region"] = parts[1]
    if len(parts) >= 3:
        result["country"] = parts[2]
    
    return result


def infer_country_code(country_name: Optional[str]) -> Optional[str]:
    """Infer ISO alpha-2 country code from country name"""
    if not country_name:
        return None
    
    country_mapping = {
        "ghana": "GH",
        "nigeria": "NG",
        "kenya": "KE",
        "south africa": "ZA",
        "tanzania": "TZ",
        "uganda": "UG",
        "ethiopia": "ET",
        "egypt": "EG",
        "morocco": "MA",
        "algeria": "DZ",
        # Add more as needed
    }
    
    normalized = country_name.lower().strip()
    return country_mapping.get(normalized)


# =============================================================================
# DATA QUALITY UTILITIES
# =============================================================================

def calculate_completeness_score(row_dict: Dict[str, Any], important_fields: List[str]) -> float:
    """Calculate data completeness score (0.0 to 1.0)"""
    if not important_fields:
        return 1.0
    
    filled_count = sum(1 for field in important_fields if row_dict.get(field))
    return filled_count / len(important_fields)


def detect_anomalies(df: DataFrame, column: str, method: str = "iqr") -> DataFrame:
    """
    Detect anomalies in numerical column using IQR or Z-score method
    
    Returns DataFrame with additional column: {column}_is_anomaly (boolean)
    """
    if method == "iqr":
        # Calculate quartiles
        quantiles = df.approxQuantile(column, [0.25, 0.75], 0.01)
        if len(quantiles) != 2:
            return df.withColumn(f"{column}_is_anomaly", F.lit(False))
        
        q1, q3 = quantiles
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        
        return df.withColumn(
            f"{column}_is_anomaly",
            (F.col(column) < lower_bound) | (F.col(column) > upper_bound)
        )
    
    return df.withColumn(f"{column}_is_anomaly", F.lit(False))


def calculate_data_quality_score(df: DataFrame, quality_checks: Dict[str, Any]) -> Dict[str, float]:
    """
    Calculate overall data quality metrics
    
    Args:
        df: Input DataFrame
        quality_checks: Dict of column -> validation function
    
    Returns:
        Dict of metric_name -> score
    """
    total_rows = df.count()
    if total_rows == 0:
        return {"completeness": 0.0, "validity": 0.0, "uniqueness": 0.0}
    
    metrics = {}
    
    # Completeness
    non_null_counts = {}
    for col in df.columns:
        non_null = df.filter(F.col(col).isNotNull()).count()
        non_null_counts[col] = non_null / total_rows
    
    metrics["completeness"] = sum(non_null_counts.values()) / len(df.columns)
    
    # Uniqueness (for key columns)
    if "unique_id" in df.columns:
        unique_count = df.select("unique_id").distinct().count()
        metrics["uniqueness"] = unique_count / total_rows
    else:
        metrics["uniqueness"] = 1.0
    
    metrics["validity"] = 1.0  # Placeholder
    
    return metrics


# =============================================================================
# TEXT PROCESSING UTILITIES
# =============================================================================

def clean_text(text: str) -> str:
    """Clean and normalize text"""
    if not text:
        return ""
    
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text)
    
    # Remove special characters but keep punctuation
    text = re.sub(r'[^\w\s.,!?;:()\-]', '', text)
    
    return text.strip()


def extract_keywords(text: str, min_length: int = 3) -> List[str]:
    """Extract keywords from text (simple tokenization)"""
    if not text:
        return []
    
    # Tokenize
    words = re.findall(r'\b\w+\b', text.lower())
    
    # Filter by length
    keywords = [w for w in words if len(w) >= min_length]
    
    # Remove common stopwords
    stopwords = {'the', 'and', 'for', 'are', 'but', 'not', 'you', 'with', 'from', 'this', 'that'}
    keywords = [w for w in keywords if w not in stopwords]
    
    return keywords


def chunk_text(text: str, chunk_size: int = 512, overlap: int = 50) -> List[Dict[str, Any]]:
    """
    Chunk text into overlapping segments for embeddings
    
    Returns list of dicts with 'text' and 'metadata'
    """
    if not text:
        return []
    
    words = text.split()
    chunks = []
    
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk_words = words[start:end]
        chunk_text = ' '.join(chunk_words)
        
        chunks.append({
            "text": chunk_text,
            "metadata": {
                "chunk_index": len(chunks),
                "start_word": start,
                "end_word": min(end, len(words)),
                "word_count": len(chunk_words)
            }
        })
        
        start = end - overlap
        
        if start >= len(words):
            break
    
    return chunks


# =============================================================================
# SPARK UDF UTILITIES
# =============================================================================

def safe_json_parse_array(json_str: str) -> List[str]:
    """Safely parse JSON array string"""
    if not json_str or json_str.lower() in ['null', 'none', '']:
        return []
    
    try:
        parsed = json.loads(json_str)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
        return [str(parsed)]
    except:
        return []


# Register as Spark UDF
@F.udf(returnType=ArrayType(StringType()))
def parse_json_array_udf(json_str):
    """UDF version of safe_json_parse_array"""
    return safe_json_parse_array(json_str)


# =============================================================================
# HASH AND ID GENERATION
# =============================================================================

def generate_row_id(*values) -> str:
    """Generate deterministic row ID from values"""
    concatenated = "||".join(str(v) if v is not None else "" for v in values)
    return hashlib.sha256(concatenated.encode()).hexdigest()


def generate_citation_id(row_id: str, source_url: str, field: str) -> str:
    """Generate citation ID"""
    return generate_row_id(row_id, source_url, field)


# =============================================================================
# MEDICAL DOMAIN UTILITIES
# =============================================================================

def categorize_facility_by_capability(capabilities: List[str]) -> str:
    """Categorize facility based on capabilities"""
    if not capabilities:
        return "basic"
    
    capabilities_lower = [c.lower() for c in capabilities]
    
    # Advanced tertiary care
    if any(kw in ' '.join(capabilities_lower) for kw in ['surgery', 'icu', 'intensive care', 'trauma']):
        return "advanced"
    
    # Secondary care
    if any(kw in ' '.join(capabilities_lower) for kw in ['inpatient', 'emergency', 'specialist']):
        return "secondary"
    
    # Primary care
    return "primary"


def detect_critical_gaps(facility_dict: Dict[str, Any]) -> List[str]:
    """Detect critical capability gaps in facility"""
    gaps = []
    
    # Check for emergency capability
    capabilities = facility_dict.get('capability', [])
    has_emergency = any('emergency' in str(c).lower() for c in capabilities)
    
    if not has_emergency:
        gaps.append("no_emergency_care")
    
    # Check for doctors
    num_doctors = facility_dict.get('numberDoctors')
    if num_doctors is None or num_doctors == 0:
        gaps.append("no_doctors")
    
    # Check for contact information
    phones = facility_dict.get('phone_numbers', [])
    email = facility_dict.get('email')
    if not phones and not email:
        gaps.append("no_contact_info")
    
    return gaps


def calculate_desert_score(
    facility_count: int,
    emergency_sites: int,
    maternal_sites: int,
    population: Optional[int] = None
) -> float:
    """
    Calculate medical desert score (higher = more desert-like)
    
    Score ranges from 0 (well-served) to 1 (severe desert)
    """
    # Base score on facility density
    base_score = 1.0 / (facility_count + 1)
    
    # Emergency care penalty
    emergency_score = 1.0 / (emergency_sites + 1)
    
    # Maternal care penalty
    maternal_score = 1.0 / (maternal_sites + 1)
    
    # Weighted average
    desert_score = (0.4 * base_score + 0.3 * emergency_score + 0.3 * maternal_score)
    
    # Adjust for population if available
    if population and population > 0:
        facilities_per_10k = (facility_count / population) * 10000
        if facilities_per_10k < 1.0:  # Less than 1 facility per 10k people
            desert_score *= 1.5  # Penalty
    
    return min(desert_score, 1.0)  # Cap at 1.0


# =============================================================================
# LOGGING AND INSTRUMENTATION
# =============================================================================

def log_pipeline_step(
    step_name: str,
    input_count: int,
    output_count: int,
    duration_seconds: float,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Create structured log entry for pipeline step"""
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "step_name": step_name,
        "input_count": input_count,
        "output_count": output_count,
        "duration_seconds": duration_seconds,
        "records_per_second": output_count / duration_seconds if duration_seconds > 0 else 0,
        "metadata": metadata or {}
    }
    
    return log_entry


def create_citation_record(
    row_id: str,
    source_url: str,
    field_name: str,
    evidence_text: str,
    agent_step: str = "unknown"
) -> Dict[str, Any]:
    """Create citation record for lineage tracking"""
    return {
        "citation_id": generate_citation_id(row_id, source_url, field_name),
        "row_id": row_id,
        "source_url": source_url,
        "field_name": field_name,
        "evidence_text": evidence_text[:1000],  # Truncate long text
        "agent_step": agent_step,
        "created_at": datetime.now().isoformat()
    }


print("✓ Utilities module loaded successfully")
