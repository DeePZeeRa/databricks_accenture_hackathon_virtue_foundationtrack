# Professional Extraction Utilities Integration

## Project: Medical Desert Detection - Ghana Healthcare Dataset
**Date**: April 10, 2026  
**Status**: ✅ Phase 1 Complete (IDP Integration) | 🚧 Phase 2 Pending (Specialty & Organization Classification)

---

## 📂 Professional Utilities Location

**Source**: `/Users/dasdeepayan08@gmail.com/databricks_accenture_hackathon_virtue_foundationtrack/databricks/prompts_and_pydantic_models/`

### Available Utilities

| File | Purpose | Status | Dependencies |
|------|---------|--------|-------------|
| **free_form.py** | Extract procedures, equipment, capabilities | ✅ **INTEGRATED** | None |
| **organization_extraction.py** | Distinguish NGOs from healthcare facilities | ⚠️ Available | None |
| **facility_and_ngo_fields.py** | Structured field extraction (addresses, contact info) | ⚠️ Available | None |
| **medical_specialties.py** | Classify 50+ medical specialties | ⚠️ Partial | ❌ Requires `fdr.config` |

---

## 🎯 Integration Status by Notebook

### ✅ 04_idp_agent_extraction (COMPLETE)
**Location**: `/databricks/notebooks/04_idp_agent_extraction`  
**Notebook ID**: 2823775431276434

#### What Was Integrated:
1. **Cell 1**: Import professional extraction utilities
   - Added sys.path configuration
   - Graceful import with fallback handling
   - Feature flag: `PROFESSIONAL_PROMPTS_AVAILABLE`

2. **Cell 2 (Documentation)**: Added comprehensive utility documentation
   - Purpose and scope of each utility
   - Expected improvements
   - Backward compatibility notes

3. **Cell 9 - Procedure Extraction Agent**: 
   - Now uses `FREE_FORM_SYSTEM_PROMPT.format(organization=facility_name)`
   - Handles professional format (array of strings) and basic format (array of objects)
   - Maintains backward compatibility

4. **Cell 10 - Equipment & Capability Extraction**:
   - Both agents use `FREE_FORM_SYSTEM_PROMPT`
   - Equipment: Handles professional string format
   - Capability: Auto-detects critical capabilities
   - Description field fallback logic preserved

5. **Cell 14 - Pipeline Execution**:
   - Tracks `professional_prompts` flag in MLflow
   - Updated to **production mode** (987 facilities)
   - Progress indicators for large-scale processing

#### Production Configuration:
```python
PROCESSING_MODE = "production"  # All 987 facilities
PROFESSIONAL_PROMPTS_AVAILABLE = True  # Using production-grade prompts
```

#### Expected Improvements:
- 🎯 Higher precision in procedure/equipment/capability classification
- 📝 Better coverage for rare specialties and equipment
- 🔍 Improved quality with stricter validation rules
- 📚 Built-in medical terminology and classification knowledge

#### Previous Baseline (50 facilities, basic prompts):
- **Procedures**: 880 (16% of facilities)
- **Equipment**: 72 (8% of facilities)
- **Capabilities**: 168 (36% of facilities)
- **Avg Confidence**: 65.25%
- **Success Rate**: 100% (50/50)

---

### ⚠️ 02_transform_silver (POTENTIAL INTEGRATION)
**Location**: `/databricks/notebooks/02_transform_silver`  
**Notebook ID**: 2823775431276406

#### Current State:
- Basic data cleaning and type casting
- Manual array parsing from JSON strings
- Address fields passed through without normalization

#### Potential Integration:
**Utility**: `facility_and_ngo_fields.py` (Structured Field Extraction)

**Benefits**:
- ✅ Better address parsing (separate street/city/state/country)
- ✅ Contact info normalization (phone, email, websites)
- ✅ Structured metadata extraction (capacity, staff counts)
- ✅ Validation rules for data quality

**Recommendation**: 
- Priority: **MEDIUM** (Nice-to-have, not critical)
- Current ETL works well for basic cleaning
- Consider if address quality becomes an issue downstream

---

### ⚠️ 03_build_gold (POTENTIAL INTEGRATION)
**Location**: `/databricks/notebooks/03_build_gold`  
**Notebook ID**: 2823775431276407

#### Current State:
- Builds 5 gold tables: profiles, claims, citations, risk signals, medical deserts
- Medical desert detection uses basic keyword matching:
  ```python
  is_emergency = exists(capability, x -> lower(x) like '%emergency%')
  is_maternal = exists(specialties, x -> lower(x) like '%gynecology%' or lower(x) like '%obstetric%')
  ```

#### Potential Integration:
**Utility**: `medical_specialties.py` (Specialty Classification) [⚠️ Requires fixing external dependency]

**Benefits**:
- ✅ Classify 50+ medical specialties systematically
- ✅ Better facility type detection (e.g., "Eye Center" → ophthalmology)
- ✅ Terminology mapping (e.g., "PMR" → physicalMedicineAndRehabilitation)
- ✅ More accurate medical desert scoring

**Recommendation**:
- Priority: **MEDIUM** (Would improve desert detection accuracy)
- Requires fixing `fdr.config.medical_specialties` dependency first
- Current keyword matching is functional but imprecise

---

### ⚠️ 01_ingest_bronze (NO INTEGRATION NEEDED)
**Location**: `/databricks/notebooks/01_ingest_bronze`  
**Notebook ID**: 2823775431276405

**Status**: Raw data ingestion only - no extraction logic

---

### ⚠️ 05_chunk_embed_vector_index (OUT OF SCOPE)
**Location**: `/databricks/notebooks/05_chunk_embed_vector_index`  
**Notebook ID**: 2823775431276422

**Status**: Vector embeddings - professional utilities not applicable

---

### ⚠️ 06_agent_reasoning_pipeline (POTENTIAL FUTURE USE)
**Location**: `/databricks/notebooks/06_agent_reasoning_pipeline`  
**Notebook ID**: 2823775431276423

**Recommendation**: Consider using `organization_extraction.py` if agent needs to distinguish NGOs from facilities during reasoning

---

### ⚠️ 07_eval_guardrails (OUT OF SCOPE)
**Location**: `/databricks/notebooks/07_eval_guardrails`  
**Notebook ID**: 2823775431276424

**Status**: Evaluation framework - professional utilities not applicable

---

## 📊 Professional Utility Details

### 1. free_form.py (✅ INTEGRATED)
**Purpose**: Extract procedures, equipment, and capabilities from unstructured facility descriptions

**Pydantic Model**: `FacilityFacts`
```python
class FacilityFacts(BaseModel):
    procedure: List[str]  # Medical procedures (e.g., "Surgery", "X-ray imaging")
    equipment: List[str]  # Medical equipment (e.g., "MRI Scanner", "Ventilators")
    capability: List[str] # Service capabilities (e.g., "24/7 Emergency Care")
```

**Enhanced Guidelines**:
- Detailed category definitions for medical procedures
- Equipment classification rules (diagnostic, treatment, support)
- Capability detection patterns (specializations, service types)
- Content analysis rules for text and images
- Quality standards and fact format requirements

**Usage in 04_idp_agent_extraction**:
```python
if PROFESSIONAL_PROMPTS_AVAILABLE:
    system_prompt = FREE_FORM_SYSTEM_PROMPT.format(organization=facility_name)
else:
    system_prompt = BASIC_PROCEDURE_PROMPT  # Fallback
```

---

### 2. organization_extraction.py (⚠️ AVAILABLE)
**Purpose**: Distinguish NGOs from healthcare facilities

**Pydantic Model**: `OrganizationExtractionOutput`
```python
class OrganizationExtractionOutput(BaseModel):
    ngos: List[str]  # Non-governmental organizations
    facilities: List[str]  # Healthcare facilities (hospitals, clinics)
    other_organizations: List[str]  # Other entities
```

**Guidelines**:
- Translation rules for non-English organization names
- Organization type classification logic
- Naming conventions and normalization

**Potential Use Cases**:
- Filter out NGOs from facility lists
- Identify partnerships between NGOs and facilities
- Separate donor organizations from service providers

**Integration Recommendation**:
- Add as a new agent in `04_idp_agent_extraction`
- OR use in `06_agent_reasoning_pipeline` for smarter queries

---

### 3. facility_and_ngo_fields.py (⚠️ AVAILABLE)
**Purpose**: Extract structured metadata (contact info, addresses, capacity, staff counts)

**Pydantic Models**:
```python
class BaseOrganization(BaseModel):
    # Contact info
    phone_numbers: Optional[List[str]]
    email: Optional[str]
    websites: Optional[List[str]]
    
    # Address (parsed into components)
    address_line1: Optional[str]
    address_city: Optional[str]
    address_stateOrRegion: Optional[str]
    address_country: Optional[str]
    
    # Social media
    facebookLink: Optional[str]
    twitterLink: Optional[str]
    linkedinLink: Optional[str]

class Facility(BaseOrganization):
    facilityTypeId: Optional[str]
    operatorTypeId: Optional[str]
    capacity: Optional[int]  # Number of beds
    numberDoctors: Optional[int]
    # ... many more facility-specific fields

class NGO(BaseOrganization):
    countries: Optional[List[str]]  # Countries of operation
    missionStatement: Optional[str]
    acceptsVolunteers: Optional[bool]
    # ... NGO-specific fields
```

**Guidelines**:
- Address parsing rules (separate street/city/state/country)
- Contact info normalization (phone formatting, email validation)
- Capacity and staff count validation

**Potential Use Cases**:
- Improve address quality in `02_transform_silver`
- Validate structured fields before loading to Unity Catalog
- Extract missing metadata from facility descriptions

**Integration Recommendation**:
- Priority: **MEDIUM**
- Current ETL is functional, but this would improve data quality
- Consider if downstream analytics need better address parsing

---

### 4. medical_specialties.py (⚠️ PARTIAL - DEPENDENCY ISSUE)
**Purpose**: Classify 50+ medical specialties from facility names and descriptions

**Pydantic Model**: `MedicalSpecialties`
```python
class MedicalSpecialties(BaseModel):
    # Boolean flags for each specialty
    cardiology: bool
    dermatology: bool
    emergencyMedicine: bool
    gynecology: bool
    neurology: bool
    oncology: bool
    ophthalmology: bool
    orthopedicSurgery: bool
    pediatrics: bool
    psychiatry: bool
    radiology: bool
    # ... 40+ more specialties
```

**System Prompt**: ❌ Requires `fdr.config.medical_specialties.MEDICAL_HIERATCHY`
- External dependency not available in this workspace
- Contains medical specialty hierarchy and classification rules

**Guidelines** (from model only):
- Facility name parsing rules (e.g., "Eye Center" → ophthalmology)
- Terminology mapping (e.g., "PMR" → physicalMedicineAndRehabilitation)
- Specialty detection from service descriptions

**Potential Use Cases**:
- Enhance medical desert detection in `03_build_gold`
- Classify facilities by specialty for better service gap analysis
- Detect missing specialties in underserved regions

**Integration Recommendation**:
- Priority: **LOW** (Blocked by external dependency)
- Requires creating standalone `MEDICAL_HIERATCHY` config
- Current keyword matching in `03_build_gold` is adequate for MVP

---

## 🚀 Next Steps

### Immediate Actions (In Progress)
1. ✅ **Run production pipeline** (04_idp_agent_extraction)
   - Process all 987 facilities with professional prompts
   - Measure improvements vs. baseline (50 facilities, basic prompts)
   - Track MLflow metrics: confidence, extraction rates, quality flags

### Short-Term Recommendations (1-2 weeks)
2. **Add Organization Classification Agent** (04_idp_agent_extraction)
   - Use `organization_extraction.py` to identify NGOs vs. facilities
   - Update gold tables to separate NGOs from healthcare providers
   - Priority: **MEDIUM**

3. **Evaluate Results**
   - Compare professional vs. basic prompt performance
   - Identify specific improvement areas (procedures, equipment, capabilities)
   - Document quality improvements for stakeholders

### Medium-Term Recommendations (1-2 months)
4. **Fix Medical Specialties Dependency**
   - Create standalone `MEDICAL_HIERATCHY` config in workspace
   - OR remove dependency and inline specialty rules
   - Integrate into `03_build_gold` for better desert detection
   - Priority: **MEDIUM**

5. **Enhance Address Parsing** (02_transform_silver)
   - Use `facility_and_ngo_fields.py` for better address normalization
   - Only if downstream analytics need better address quality
   - Priority: **LOW**

### Long-Term Considerations (3+ months)
6. **Extend to Other Datasets**
   - Apply professional utilities to other country datasets (if available)
   - Standardize extraction across multiple geographies
   - Build reusable extraction templates

---

## 📈 Success Metrics

### Phase 1: IDP Integration (✅ COMPLETE)
- ✅ Professional utilities imported successfully
- ✅ Procedure extraction agent updated
- ✅ Equipment extraction agent updated
- ✅ Capability extraction agent updated
- ✅ Backward compatibility maintained
- ✅ Production pipeline ready (987 facilities)

### Phase 2: Production Validation (🚧 IN PROGRESS)
- ⏳ Run full production extraction (987 facilities)
- ⏳ Measure extraction rate improvements
- ⏳ Compare confidence scores (professional vs. basic)
- ⏳ Validate quality flag accuracy
- ⏳ Document specific improvements

### Phase 3: Extended Integration (📋 PLANNED)
- ⬜ Add organization classification agent
- ⬜ Fix medical specialties dependency
- ⬜ Integrate into gold table building
- ⬜ Enhance medical desert detection

---

## 🔧 Technical Notes

### Import Pattern
```python
import sys

# Add project root to sys.path
project_root = "/Workspace/Users/dasdeepayan08@gmail.com/databricks_accenture_hackathon_virtue_foundationtrack/databricks"
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Import with graceful fallbacks
try:
    from prompts_and_pydantic_models.free_form import FREE_FORM_SYSTEM_PROMPT, FacilityFacts
    PROFESSIONAL_PROMPTS_AVAILABLE = True
except ImportError as e:
    print(f"⚠️ Professional utilities unavailable: {e}")
    PROFESSIONAL_PROMPTS_AVAILABLE = False
```

### Backward Compatibility
All agents maintain fallback logic:
```python
if PROFESSIONAL_PROMPTS_AVAILABLE:
    system_prompt = FREE_FORM_SYSTEM_PROMPT.format(organization=facility_name)
else:
    system_prompt = BASIC_PROCEDURE_PROMPT  # Original prompt
```

### Feature Detection
Robust handling of different response formats:
```python
if isinstance(procedures, list):
    if procedures and isinstance(procedures[0], str):
        # Professional format: ["Surgery", "X-ray imaging"]
        for proc in procedures:
            state["procedures"].append({"procedure_name": proc, ...})
    else:
        # Basic format: [{"procedure_name": "Surgery"}, ...]
        state["procedures"].extend(procedures)
```

---

## 📞 Contact & Support

**Project Lead**: dasdeepayan08@gmail.com  
**Workspace**: Databricks Unity Catalog (`vf_health.ghana`)  
**Repository**: `/Users/dasdeepayan08@gmail.com/databricks_accenture_hackathon_virtue_foundationtrack/`

**Questions?**
- Check notebook: [04_idp_agent_extraction](#notebook-2823775431276434)
- Review utilities: `/databricks/prompts_and_pydantic_models/`
- Contact project maintainer

---

**Last Updated**: April 10, 2026  
**Document Version**: 1.0  
**Status**: Phase 1 Complete ✅ | Phase 2 In Progress 🚧