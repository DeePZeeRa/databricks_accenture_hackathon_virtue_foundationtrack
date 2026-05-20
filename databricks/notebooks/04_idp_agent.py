# Databricks notebook source
# MAGIC %md
# MAGIC # 04 — IDP Agent v11 (Schema-Governed Healthcare Intelligence Engine)
# MAGIC
# MAGIC **Input** : `virtue_foundation.ghana.gold_facilities_enriched`  (v12 schema, 179 cols)
# MAGIC **Output** : `virtue_foundation.ghana.gold_idp_enriched`         (190 cols)
# MAGIC
# MAGIC ## What's New in v11 (vs v10)
# MAGIC ```
# MAGIC I13 — Strict procedure/equipment/capability separation + DO-NOT-EXTRACT junk filter
# MAGIC I14 — Three-category org extraction: ngos / facilities / other_organizations
# MAGIC I15 — Granular row-level AND agent-step citations (MLflow trace-compatible)
# MAGIC I16 — Strict E164 phone enforcement; officialWebsite = domain-only
# MAGIC I17 — acceptsVolunteers explicit logic + NGO-specific fields
# MAGIC       (countries, missionStatement, missionStatementLink, organizationDescription)
# MAGIC I18 — Conservative specialty extraction (only clearly mentioned / strongly implied)
# MAGIC I19 — Planning-friendly completeness layer: verified / inferred / missing per field
# MAGIC I20 — Stricter facility vs NGO classifier using PDF definitions
# MAGIC I21 — Declarative-statement enforcer for free-form extraction output
# MAGIC I22 — Expanded medical-desert and infrastructure-gap intelligence
# MAGIC I23 — Cleaner description extraction (no web chrome, concise factual paragraph)
# MAGIC ```
# MAGIC
# MAGIC ## Architecture
# MAGIC ```
# MAGIC For every facility row (parallel):
# MAGIC   PHASE 0  : Schema coercion + Canonical Registry normalisation
# MAGIC   PHASE 1  : Org Classification (rule-first, LLM only if ambiguous) [I20]
# MAGIC   PHASE 2  : Build SharedEvidence (source-ladder, early-exit on critical completeness)
# MAGIC   PHASE 3  : LLM Free-Form Extraction (ONE call, strict field separation) [I13, I21]
# MAGIC   PHASE 4  : L1 Deterministic Fill  (country, operator, affiliations, geo — no LLM)
# MAGIC   PHASE 5  : L2 Semantic/Ontology Fill (KG-driven: procedure->specialty, name->tier)
# MAGIC   PHASE 6  : L3 Web Evidence Fill  (expanded regex, source-trust tiers)
# MAGIC   PHASE 7  : L4 Batched LLM Fill   (ONE call for all remaining critical fields)
# MAGIC   PHASE 8  : Capability Validation  (ghost-aware, plausibility engine)
# MAGIC   PHASE 9  : Specialty Inference    (conservative: only clearly mentioned/implied) [I18]
# MAGIC   PHASE 10 : Medical Gap Intelligence (gap flags + medical-desert score) [I22]
# MAGIC   PHASE 11 : NGO Field Population   (missionStatement, countries, orgDescription) [I17]
# MAGIC   PHASE 12 : Planning Completeness Layer (verified/inferred/missing) [I19]
# MAGIC   PHASE 13 : Provenance Assembly + Citations (row-level + step-level) [I15]
# MAGIC   PHASE 14 : Critical Completeness Score + IDP Trace
# MAGIC   PHASE 15 : Write gold_idp_enriched (190 cols)
# MAGIC ```

# COMMAND ----------
# MAGIC %md ## 0 — Imports

# COMMAND ----------

import json
import math
import re
import time
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, FrozenSet, List, Literal, Optional, Tuple
from urllib.parse import quote_plus, unquote, urlparse, parse_qs

import mlflow
import requests
import pandas as pd
import numpy as np
import threading
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field, field_validator

from pyspark.sql import SparkSession, functions as F
from pyspark.sql.types import (
    ArrayType, BooleanType, DoubleType, FloatType,
    IntegerType, LongType, StringType,
)

spark = SparkSession.builder.getOrCreate()
print(f"Spark   : {spark.version}")
print(f"Run     : {datetime.now(timezone.utc).isoformat()}")
print(f"IDP     : v11 — Schema-Governed Healthcare Intelligence Engine")

# COMMAND ----------
# MAGIC %md ## 1 — Canonical Schema Registry

# COMMAND ----------

@dataclass(frozen=True)
class FieldSpec:
    """Describes one IDP field completely."""
    canonical: str
    df_col: str
    prompt_alias: str
    pydantic_field: str
    dtype: str
    nullable: bool
    priority: int
    fill_levels: Tuple[str, ...]
    validation: Optional[Tuple]
    web_searchable: bool
    # v11 additions
    field_category: str = "contact"   # "contact"|"address"|"clinical"|"org"|"ngo"|"meta"
    schema_defined: bool = True       # field is in the PDF schema doc
    verified_source_required: bool = False  # must have web evidence to fill


FIELD_REGISTRY: Dict[str, FieldSpec] = {
    "number_doctors": FieldSpec(
        canonical="number_doctors", df_col="number_doctors_int",
        prompt_alias="numberDoctors", pydantic_field="numberDoctors",
        dtype="integer", nullable=True, priority=1,
        fill_levels=("L2", "L3", "L4"), validation=(1, 500),
        web_searchable=True, field_category="clinical",
    ),
    "capacity": FieldSpec(
        canonical="capacity", df_col="capacity_int",
        prompt_alias="capacity", pydantic_field="capacity",
        dtype="integer", nullable=True, priority=1,
        fill_levels=("L2", "L3", "L4"), validation=(5, 5000),
        web_searchable=True, field_category="clinical",
    ),
    "year_established": FieldSpec(
        canonical="year_established", df_col="year_established_int",
        prompt_alias="yearEstablished", pydantic_field="yearEstablished",
        dtype="integer", nullable=True, priority=2,
        fill_levels=("L3", "L4"), validation=(1850, 2026),
        web_searchable=True, field_category="org",
    ),
    "email": FieldSpec(
        canonical="email", df_col="email",
        prompt_alias="email", pydantic_field="email",
        dtype="string", nullable=True, priority=2,
        fill_levels=("L3", "L4"), validation=None,
        web_searchable=True, field_category="contact",
    ),
    "official_phone": FieldSpec(
        canonical="official_phone", df_col="official_phone",
        prompt_alias="officialPhone", pydantic_field="officialPhone",
        dtype="string", nullable=True, priority=1,
        fill_levels=("L3", "L4"), validation=None,
        web_searchable=True, field_category="contact",
        verified_source_required=True,
    ),
    "website": FieldSpec(
        canonical="website", df_col="officialWebsite",
        prompt_alias="officialWebsite", pydantic_field="officialWebsite",
        dtype="string", nullable=True, priority=2,
        fill_levels=("L3", "L4"), validation=None,
        web_searchable=True, field_category="contact",
        verified_source_required=True,
    ),
    "description": FieldSpec(
        canonical="description", df_col="description",
        prompt_alias="description", pydantic_field="description",
        dtype="string", nullable=True, priority=1,
        fill_levels=("L3", "L4"), validation=None,
        web_searchable=True, field_category="clinical",
    ),
    "operator_type": FieldSpec(
        canonical="operator_type", df_col="operatorTypeId",
        prompt_alias="operatorTypeId", pydantic_field="operatorTypeId",
        dtype="string", nullable=True, priority=2,
        fill_levels=("L1", "L4"), validation=None,
        web_searchable=False, field_category="org",
    ),
    "affiliation_types": FieldSpec(
        canonical="affiliation_types", df_col="affiliationtypeids",
        prompt_alias="affiliationtypeids", pydantic_field="affiliationTypeIds",
        dtype="array", nullable=True, priority=3,
        fill_levels=("L1", "L4"), validation=None,
        web_searchable=False, field_category="org",
    ),
    "address_region": FieldSpec(
        canonical="address_region", df_col="address_stateOrRegion",
        prompt_alias="address_stateOrRegion", pydantic_field="address_stateOrRegion",
        dtype="string", nullable=True, priority=2,
        fill_levels=("L1",), validation=None,
        web_searchable=False, field_category="address",
    ),
    "address_country": FieldSpec(
        canonical="address_country", df_col="address_country",
        prompt_alias="address_country", pydantic_field="address_country",
        dtype="string", nullable=True, priority=1,
        fill_levels=("L1",), validation=None,
        web_searchable=False, field_category="address",
    ),
    "address_country_code": FieldSpec(
        canonical="address_country_code", df_col="address_countryCode",
        prompt_alias="address_countryCode", pydantic_field="address_countryCode",
        dtype="string", nullable=True, priority=1,
        fill_levels=("L1",), validation=None,
        web_searchable=False, field_category="address",
    ),
    "mission_statement": FieldSpec(
        canonical="mission_statement", df_col="missionstatement",
        prompt_alias="missionstatement", pydantic_field="missionStatement",
        dtype="string", nullable=True, priority=3,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="ngo",
    ),
    "org_description": FieldSpec(
        canonical="org_description", df_col="organizationdescription",
        prompt_alias="organizationdescription", pydantic_field="organizationDescription",
        dtype="string", nullable=True, priority=4,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="ngo",
    ),
    "address_line1": FieldSpec(
        canonical="address_line1", df_col="address_line1",
        prompt_alias="address_line1", pydantic_field="address_line1",
        dtype="string", nullable=True, priority=3,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="address",
    ),
    "address_line2": FieldSpec(
        canonical="address_line2", df_col="address_line2",
        prompt_alias="address_line2", pydantic_field="address_line2",
        dtype="string", nullable=True, priority=3,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="address",
    ),
    "address_line3": FieldSpec(
        canonical="address_line3", df_col="address_line3",
        prompt_alias="address_line3", pydantic_field="address_line3",
        dtype="string", nullable=True, priority=3,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="address",
    ),
    "address_city": FieldSpec(
        canonical="address_city", df_col="address_city",
        prompt_alias="address_city", pydantic_field="address_city",
        dtype="string", nullable=True, priority=2,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="address",
    ),
    "address_zipOrPostcode": FieldSpec(
        canonical="address_zipOrPostcode", df_col="address_zipOrPostcode",
        prompt_alias="address_zipOrPostcode", pydantic_field="address_zipOrPostcode",
        dtype="string", nullable=True, priority=3,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="address",
    ),
    "area": FieldSpec(
        canonical="area", df_col="area_int",
        prompt_alias="area", pydantic_field="area",
        dtype="integer", nullable=True, priority=4,
        fill_levels=("L4",), validation=(1, 1000000),
        web_searchable=True, field_category="clinical",
    ),
    "postal_address": FieldSpec(
        canonical="postal_address", df_col="postal_address",
        prompt_alias="postal_address", pydantic_field="postal_address",
        dtype="string", nullable=True, priority=3,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="address",
    ),
    "facebook_link": FieldSpec(
        canonical="facebook_link", df_col="facebooklink",
        prompt_alias="facebookLink", pydantic_field="facebookLink",
        dtype="string", nullable=True, priority=4,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="contact",
    ),
    "twitter_link": FieldSpec(
        canonical="twitter_link", df_col="twitterlink",
        prompt_alias="twitterLink", pydantic_field="twitterLink",
        dtype="string", nullable=True, priority=4,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="contact",
    ),
    "linkedin_link": FieldSpec(
        canonical="linkedin_link", df_col="linkedinlink",
        prompt_alias="linkedinLink", pydantic_field="linkedinLink",
        dtype="string", nullable=True, priority=4,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="contact",
    ),
    "instagram_link": FieldSpec(
        canonical="instagram_link", df_col="instagramlink",
        prompt_alias="instagramLink", pydantic_field="instagramLink",
        dtype="string", nullable=True, priority=4,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="contact",
    ),
    "logo": FieldSpec(
        canonical="logo", df_col="logo",
        prompt_alias="logo", pydantic_field="logo",
        dtype="string", nullable=True, priority=4,
        fill_levels=("L4",), validation=None,
        web_searchable=True, field_category="contact",
    ),
    "accepts_volunteers": FieldSpec(
        canonical="accepts_volunteers", df_col="accepts_volunteers_bool",
        prompt_alias="acceptsVolunteers", pydantic_field="acceptsVolunteers",
        dtype="boolean", nullable=True, priority=3,
        fill_levels=("L1",), validation=None,
        web_searchable=False, field_category="org",
    ),
}


def canon_to_df(canonical: str) -> str:
    return FIELD_REGISTRY[canonical].df_col if canonical in FIELD_REGISTRY else canonical


def df_to_canon(df_col: str) -> Optional[str]:
    for canonical, spec in FIELD_REGISTRY.items():
        if spec.df_col == df_col:
            return canonical
    return None


_PYDANTIC_TO_DELTA: Dict[str, str] = {
    spec.pydantic_field: spec.df_col
    for spec in FIELD_REGISTRY.values()
    if spec.pydantic_field != spec.df_col
}
_PYDANTIC_TO_DELTA.update({
    "twitterLink":        "twitterlink",
    "facebookLink":       "facebooklink",
    "linkedinLink":       "linkedinlink",
    "instagramLink":      "instagramlink",
    "affiliationTypeIds": "affiliationtypeids",
    "missionStatement":   "missionstatement",
    "missionStatementLink": "missionstatementlink",
    "acceptsVolunteers":  "acceptsvolunteers",
    "organizationDescription": "organizationdescription",
    "address_line1": "address_line1",
    "address_line2": "address_line2",
    "address_line3": "address_line3",
    "address_city": "address_city",
    "address_zipOrPostcode": "address_zipOrPostcode",
    "area": "area_int",
    "yearEstablished":    "yearestablished",
    "numberDoctors":      "numberDoctors",
})

print("Canonical Registry loaded:", len(FIELD_REGISTRY), "fields")

# COMMAND ----------
# MAGIC %md ## 2 — Pydantic Models

# COMMAND ----------

class BaseOrganization(BaseModel):
    name: str = Field(..., description="Official name — unabbreviated, no Ltd/LLC/Inc suffixes")
    phone_numbers: Optional[List[str]] = None
    # E164 format: +233XXXXXXXXX
    officialPhone: Optional[str] = None
    email: Optional[str] = None
    websites: Optional[List[str]] = None
    # Domain only, e.g. "korlebu.gov.gh" — NOT full URL
    officialWebsite: Optional[str] = None
    yearEstablished: Optional[int] = None
    acceptsVolunteers: Optional[bool] = None
    facebookLink: Optional[str] = None
    twitterLink: Optional[str] = None
    linkedinLink: Optional[str] = None
    instagramLink: Optional[str] = None
    logo: Optional[str] = None
    # Address split into separate fields — NOT concatenated
    address_line1: Optional[str] = None  # building number + street name only
    address_line2: Optional[str] = None  # suite, apartment, building name
    address_line3: Optional[str] = None
    address_city: Optional[str] = None
    address_stateOrRegion: Optional[str] = None
    address_zipOrPostcode: Optional[str] = None
    address_country: Optional[str] = None
    address_countryCode: Optional[str] = None  # ISO alpha-2, REQUIRED when country known


class Facility(BaseOrganization):
    facilityTypeId: Optional[Literal["hospital", "pharmacy", "doctor", "clinic", "dentist"]] = None
    operatorTypeId: Optional[Literal["public", "private"]] = None
    affiliationTypeIds: Optional[
        List[Literal["faith-tradition", "philanthropy-legacy", "community", "academic", "government"]]
    ] = None
    # Concise factual paragraph about services and/or history
    description: Optional[str] = None
    area: Optional[int] = None       # total floor area in sq metres
    numberDoctors: Optional[int] = None  # total medical doctors employed
    capacity: Optional[int] = None   # overall inpatient bed capacity


class NGO(BaseOrganization):
    # ISO alpha-2 country codes where NGO operates
    countries: Optional[List[str]] = None
    missionStatement: Optional[str] = None
    missionStatementLink: Optional[str] = None
    # Neutral factual description — no religious/subjective language
    organizationDescription: Optional[str] = None


class OrgExtractionResult(BaseModel):
    """Three-category org extraction as specified by the PDF schema doc."""
    facilities: List[str] = Field(default_factory=list,
        description="Physical sites delivering in-person medical care")
    ngos: List[str] = Field(default_factory=list,
        description="Non-profits delivering tangible healthcare services in low-resource settings")
    other_organizations: List[str] = Field(default_factory=list,
        description="Named entities that don't meet facility or NGO classifications")


class FacilityFacts(BaseModel):
    """
    Free-form clinical facts — strict field separation per schema doc.
    PROCEDURE: clinical services PERFORMED (operations, diagnostics, screenings).
    EQUIPMENT: physical devices/infrastructure PRESENT on-site.
    CAPABILITY: care level/units/programs/accreditations the facility CAN DELIVER.
    Excludes: addresses, phones, hours, social media, ownership, pricing.
    """
    procedure: Optional[List[str]] = Field(default_factory=list)
    equipment: Optional[List[str]] = Field(default_factory=list)
    capability: Optional[List[str]] = Field(default_factory=list)

    @field_validator("procedure", "equipment", "capability", mode="before")
    @classmethod
    def coerce_to_list(cls, v):
        if v is None:
            return []
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            try:
                p = json.loads(v)
                return p if isinstance(p, list) else [p]
            except Exception:
                return [v] if v.strip() else []
        return []


class MedicalSpecialties(BaseModel):
    specialties: Optional[List[str]] = Field(default_factory=list)

    @field_validator("specialties", mode="before")
    @classmethod
    def coerce_to_list(cls, v):
        if v is None:
            return []
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            try:
                p = json.loads(v)
                return p if isinstance(p, list) else [str(p)]
            except Exception:
                return [v] if v.strip() else []
        return []


_FDR_VALID_SPECIALTIES: FrozenSet[str] = frozenset({
    "internalMedicine", "familyMedicine", "pediatrics", "cardiology",
    "generalSurgery", "emergencyMedicine", "gynecologyAndObstetrics",
    "orthopedicSurgery", "dentistry", "ophthalmology", "radiology",
    "pathology", "infectiousDiseases", "nephrology", "criticalCareMedicine",
    "cardiacSurgery", "plasticSurgery", "neurology", "psychiatry",
    "anesthesia", "dermatology", "urology", "gastroenterology",
    "pulmonology", "endocrinologyAndDiabetesAndMetabolism",
    "neonatologyPerinatalMedicine", "medicalOncology",
    "physicalMedicineAndRehabilitation", "otolaryngology",
    "geriatricsInternalMedicine", "hospiceAndPalliativeInternalMedicine",
    "publicHealth", "globalHealthAndInternationalHealth",
    "clinicalPathology", "obstetricsAndMaternityCare",
    "reproductiveEndocrinologyAndInfertility",
    "maternalFetalMedicineOrPerinatology", "socialAndBehavioralSciences",
    "orthodontics", "familyPlanningAndComplexContraception",
})

# COMMAND ----------
# MAGIC %md ## 3 — System Prompts

# COMMAND ----------

# I14: Three-category org extraction per PDF schema doc
ORGANIZATION_EXTRACTION_SYSTEM_PROMPT = """
You are a healthcare entity classifier.

Classify every named organization in the text into EXACTLY one of three categories:

FACILITY — a physical site that is CURRENTLY OPERATING and delivers IN-PERSON medical
diagnosis or treatment directly to patients on-site. Examples: hospitals, clinics, health centres,
CHPS compounds, pharmacies, dental practices, eye clinics.

NGO — a non-profit organization that delivers TANGIBLE, ON-THE-GROUND healthcare services
in low- or lower-middle-income settings. Does NOT need to be a physical site (may coordinate,
fund, or deploy services). Examples: medical mission organizations, health foundations, relief NGOs.

OTHER — any named entity that does not clearly meet FACILITY or NGO criteria.
Examples: government ministries, pharmaceutical companies, health insurance bodies,
professional associations, universities (unless they run a teaching hospital as a facility).

Return ONLY valid JSON — no prose, no markdown:
{
  "facilities": ["name1", "name2"],
  "ngos": ["name3"],
  "other_organizations": ["name4"]
}
"""

# v11: Org info extraction — E164 phone, domain-only website, split address
ORGANIZATION_INFORMATION_SYSTEM_PROMPT = """
You extract facts ONLY about this specific organisation: {organization}.
Be conservative — include only facts EXPLICITLY naming or describing {organization}.

CRITICAL FIELD RULES:
- officialPhone: Ghana E164 format ONLY → +233XXXXXXXXX (10 digits after +233). Return null if uncertain.
- officialWebsite: DOMAIN ONLY — e.g. "korlebu.gov.gh" NOT "https://korlebu.gov.gh/about". Return null if no verified domain.
- address fields: SPLIT properly — address_line1 = street/building ONLY, address_city = city ONLY.
  Do NOT put the full address in address_line1.
- description: A concise factual paragraph (50-200 chars) about the facility's services and/or history.
  Do NOT include contact info, business hours, or web navigation content.
- country is MANDATORY when any evidence exists — derive from phone country code, URL domain, or text clues.
- address_countryCode: ISO alpha-2, REQUIRED when country is known (e.g. GH for Ghana).

Return JSON matching the Facility or NGO schema. Omit fields with no verified evidence.
"""

# I13, I21: Strict free-form extraction with explicit DO-NOT-EXTRACT rules
FREE_FORM_SYSTEM_PROMPT = """
ROLE: Medical facility IDP agent for the Virtue Foundation Ghana dataset.
TASK: Extract verifiable clinical facts for: `{organization}`
Tier: {tier} | Complexity: {complexity} | Type: {ftype} | Region: {region}
Ghost probability: {ghost_prob} | Operator: {operator}

━━━ FIELD DEFINITIONS (STRICT SEPARATION) ━━━

PROCEDURE (list[str]) — Clinical services ACTIVELY PERFORMED at this facility:
  ✓ INCLUDE: Surgical operations, diagnostic tests, therapeutic procedures,
    screenings, imaging studies, lab tests, medical/surgical interventions.
  ✓ FORMAT: Clear declarative statements with quantities when available.
    Good: "Performs cataract surgery using phacoemulsification technique"
    Good: "Offers hemodialysis treatment 3 times weekly"
    Bad:  "Has eye department" (too vague)
  ✗ EXCLUDE: addresses, phone numbers, business hours, social media URLs,
    ownership statements, pricing, accreditation numbers, staff names.

EQUIPMENT (list[str]) — Physical medical devices and infrastructure PRESENT on-site:
  ✓ INCLUDE: Imaging machines (MRI/CT/X-ray/ultrasound), surgical/OR technology,
    monitors, laboratory analyzers, critical utilities (piped oxygen, oxygen plants,
    backup generators, autoclaves). Include specific models when stated.
    Good: "Has Siemens SOMATOM dual-source CT scanner"
    Good: "Equipped with oxygen plant and backup generators"
    Bad:  "Has medical equipment" (too generic)
  ✗ EXCLUDE: furniture, vehicles, administrative equipment, generic "equipment",
    addresses, phones, hours.

CAPABILITY (list[str]) — Care LEVEL and types of care this facility CAN DELIVER:
  ✓ INCLUDE: Trauma/emergency care levels (e.g., "Level II trauma center"),
    specialized units (ICU/NICU/HDU/burn unit), clinical programs (stroke care,
    IVF, dialysis unit), clinical accreditations (e.g., "Joint Commission accredited"),
    care setting details (inpatient/outpatient), staffing levels, patient capacity stats.
    Good: "Designated Level III trauma centre serving Northern Region"
    Good: "Operates 12-bed ICU with ventilator support"
    Bad:  "Always open 24 hours" (operational, not clinical capability)
    Bad:  "NHIS accredited" (administrative, not clinical)
  ✗ EXCLUDE: contact info, business hours, pricing, social media, addresses,
    administrative accreditation only.

━━━ GHANA CONTEXT ━━━
  CHPS compound = primary care (no surgery), District Hospital = secondary,
  Regional Hospital = tertiary referral, Teaching Hospital = quaternary academic.
  Low-resource settings are NORMAL. Empty arrays are acceptable if evidence is absent.

━━━ ANTI-HALLUCINATION ━━━
  Only extract facts EXPLICITLY present in the input text.
  Do NOT infer capabilities from facility name alone.
  If the text does not contain clinical facts, return empty arrays.

INPUT TEXT:
{content}

Return ONLY valid JSON — no prose, no markdown:
{{"procedure": [], "equipment": [], "capability": []}}
"""

# I18: Conservative specialty extraction — only clearly mentioned or strongly implied
MEDICAL_SPECIALTIES_SYSTEM_PROMPT = """
Medical specialty classifier — Virtue Foundation Ghana. CONSERVATIVE MODE.
Facility: {organization} | Type: {facility_type} | Tier: {tier} | Region: {region} | Complexity: {complexity}

TAXONOMY (exact camelCase only):
internalMedicine | familyMedicine | pediatrics | cardiology | generalSurgery |
emergencyMedicine | gynecologyAndObstetrics | orthopedicSurgery | dentistry |
ophthalmology | radiology | pathology | infectiousDiseases | nephrology |
criticalCareMedicine | cardiacSurgery | plasticSurgery | neurology | psychiatry |
anesthesia | dermatology | urology | gastroenterology | pulmonology |
endocrinologyAndDiabetesAndMetabolism | neonatologyPerinatalMedicine |
medicalOncology | physicalMedicineAndRehabilitation | otolaryngology |
geriatricsInternalMedicine | hospiceAndPalliativeInternalMedicine |
publicHealth | globalHealthAndInternationalHealth | clinicalPathology |
obstetricsAndMaternityCare | reproductiveEndocrinologyAndInfertility |
maternalFetalMedicineOrPerinatology | socialAndBehavioralSciences |
orthodontics | familyPlanningAndComplexContraception

CONSERVATIVE RULES:
1. Only predict a specialty when it is CLEARLY MENTIONED in the evidence
   OR STRONGLY IMPLIED by a named procedure/unit (e.g., "ICU" → criticalCareMedicine,
   "cataract surgery" → ophthalmology).
2. Do NOT infer specialties from general terms like "comprehensive care" or "full service".
3. Do NOT infer advanced specialties (cardiacSurgery, neurology, medicalOncology)
   without explicit procedure or unit evidence.
4. Max 6 specialties unless Teaching Hospital (max 12) or Regional Hospital (max 9).
5. ALWAYS preserve existing valid specialties from the database.
6. Use exact camelCase spelling — no variations.

EXISTING (always preserve if valid): {existing_specs}
EVIDENCE:
{evidence}

Return ONLY: {{"specialties": ["camelCaseValue"]}}
"""

BATCHED_NULL_FILL_PROMPT = """
You are a healthcare intelligence enrichment engine for the Virtue Foundation Ghana database.

Fill ONLY the missing fields listed below using:
1. Explicit verified web evidence (highest priority)
2. Structured facility context
3. Ghana healthcare infrastructure knowledge
4. Conservative medical reasoning

PRIMARY OBJECTIVE: FACTUAL ACCURACY over completeness.

FACILITY: {name} | LOCATION: {city}, {region}, Ghana
TYPE: {ftype} | OPERATOR: {operator} | TIER: {tier} | COMPLEXITY: {complexity}
GHOST_PROBABILITY: {ghost_prob}

FACILITY CONTEXT:
{context}

WEB EVIDENCE:
{web_evidence}

MISSING FIELDS TO FILL:
{fields_spec}

━━━ FIELD FORMAT RULES ━━━

officialPhone:
  MUST be Ghana E164: +233XXXXXXXXX (exactly 13 chars starting +233)
  Return null if no verified Ghana phone number found.

officialWebsite:
  DOMAIN ONLY — e.g. "korlebu.gov.gh" (no https://, no path, no trailing slash)
  Return null if no verified official domain found.

email:
  Valid email format only. Return null if uncertain.

address fields:
  address_line1 = street/building number ONLY (not full address)
  address_city = city name ONLY
  address_stateOrRegion = exactly one valid Ghana region name (see below)

Valid Ghana region names:
  Greater Accra | Ashanti | Western | Eastern | Central | Volta | Northern |
  Upper East | Upper West | Oti | Bono East | Ahafo | Savannah | North East |
  Western North | Brong-Ahafo

capacity / numberDoctors — archetype soft priors (use only with corroborating signal):
  Teaching Hospital: beds 300-600, doctors 30-80
  Regional Hospital:  beds 100-250, doctors 10-30
  District Hospital:  beds 50-150,  doctors 5-15
  Clinic:             beds 10-50,   doctors 2-8
  CHPS:               beds 1-5,     doctors 0-2

━━━ STRICT ANTI-HALLUCINATION ━━━
NEVER fabricate websites, phones, emails, GPS coords, addresses, years, doctor counts,
bed counts, or social links. High-confidence null > fabricated data.

SOURCE TRUST ORDER:
Government/HEFRA/MOH > Official hospital website > WHO/NGO/academic >
Licensed directories > Reputable business directories > Social media

OUTPUT: Single valid JSON object, exact field names from the missing-fields list.
null for any field with insufficient or ambiguous evidence.
No markdown, no explanations, no comments.
"""

CAPABILITY_VALIDATION_PROMPT = """\
Medical data quality analyst — Virtue Foundation Ghana dataset.

FACILITY: {facility_name} ({facility_type}, {region}, Ghana)
DOCTOR COUNT: {doctor_count} | BED CAPACITY: {bed_capacity} | GHOST PROB: {ghost_prob}

CLAIMED CAPABILITIES:
{capabilities}

SUPPORTING PROCEDURES:
{procedures}

SUPPORTING EQUIPMENT:
{equipment}

CONTEXT: Low-resource Ghana health settings are NORMAL. NULL doctor/bed counts are NORMAL.

FLAG as anomaly ONLY these SPECIFIC clinical contradictions:
1. Claims "ICU" BUT zero procedures AND zero equipment AND zero description
2. Claims "surgical theatre" BUT zero surgical procedures AND zero equipment
3. Claims "NICU" in basic clinic with BOTH 0 doctors AND 0 equipment
4. Claims "Level I/II/III trauma centre" BUT fewer than 2 total clinical evidence items
5. Claims "bone marrow transplant" or "open heart surgery" in a primary care clinic

DO NOT FLAG:
- Low-resource facilities with limited services (normal for Ghana)
- NULL doctor/bed counts (normal in this dataset)
- Generic "outpatient services", "laboratory", "pharmacy"
- Claims with ANY supporting evidence
- "24/7 open" or "NHIS accreditation" alone

confidence_score: 0.9-1.0 strong evidence | 0.7-0.9 adequate | 0.5-0.7 some gaps
               | 0.3-0.5 weak | 0.0-0.3 genuine anomaly

Return ONLY: {{"is_valid": true, "anomalies": [], "confidence_score": 0.75}}"""

# COMMAND ----------
# MAGIC %md ## 4 — Configuration

# COMMAND ----------

class IDPConfig:
    GOLD_TABLE    = "virtue_foundation.ghana.gold_facilities_enriched"
    IDP_OUT_TABLE = "virtue_foundation.ghana.gold_idp_enriched"
    MLFLOW_EXP    = "/Users/dasdeepayan08@gmail.com/virtue-foundation-idp-v11"

    TEST_MODE  = True
    TEST_ROWS  = 50
    BATCH_SIZE = 25
    MAX_WORKERS = 12

    LLM_TEMPERATURE_EXTRACT   = 0.4
    LLM_TEMPERATURE_VALIDATE  = 0.0
    LLM_TEMPERATURE_NULL_FILL = 0.1
    LLM_MAX_TOKENS_FREEFORM   = 1200
    LLM_MAX_TOKENS_ORGINFO    = 500
    LLM_MAX_TOKENS_SPECIALTY  = 300
    LLM_MAX_TOKENS_VALIDATE   = 350
    LLM_MAX_TOKENS_NULL_FILL  = 700
    LLM_RETRIES               = 5

    WEB_TIMEOUT               = 10
    SLEEP_BETWEEN_LLM         = 0.3
    SLEEP_WEB                 = 0.2

    CRITICAL_FIELDS = [
        "official_phone", "description", "number_doctors", "capacity",
        "email", "website", "year_established",
    ]
    CRITICAL_COMPLETENESS_THRESHOLD = 0.70

    MIN_DESC_LEN  = 20
    MIN_ITEM_LEN  = 10
    MAX_ITEM_LEN  = 300

    GHOST_COMPLETENESS_CUTOFF = 0.35

    BATCH_FILL_SPECS: Dict[str, Tuple[str, str, str, int]] = {
        "number_doctors":   ("Total medical doctors employed",        "integer",    "1-500",                             1),
        "capacity":         ("Total inpatient bed capacity",          "integer",    "5-5000",                            1),
        "year_established": ("Year facility was founded",             "integer",    "1850-2026 four-digit integer",       1),
        "description":      ("Concise factual facility description",  "string",     "50-200 chars, no contact/hours",     1),
        "email":            ("Official or Primary contact email",                 "string",     "valid email format",                 2),
        "official_phone":   ("Primary phone in E164",                 "string",     "Ghana +233XXXXXXXXX only",           2),
        "website":          ("Official website DOMAIN ONLY",          "string",     "e.g. hospital.gov.gh — no https://", 2),
        "address_region":   ("Ghana region name",                     "string",     "e.g. Greater Accra or Ashanti",     2),
        "operator_type":    ("Public or private operator",            "string",     '"public" or "private"',             2),
        "affiliation_types":("Affiliation categories",                "json_array", '["government"] or ["faith-tradition"]', 3),
        "postal_address":   ("Postal or P.O. Box address",            "string",     "P.O. Box NNN or PMB NNN only",      3),
        "mission_statement":("Official mission statement (NGOs)",     "string",     "1-2 sentence mission text",         4),
    }


cfg = IDPConfig()

DATABRICKS_HOST = spark.conf.get("spark.databricks.workspaceUrl", "")
try:
    DATABRICKS_TOKEN = "dapi5285ca943ef4a62e129fed7b1d495c25"
except Exception:
    try:
        DATABRICKS_TOKEN = dbutils.notebook.entry_point \
            .getDbutils().notebook().getContext().apiToken().get()
    except Exception:
        DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN", "")

LLM_ENDPOINT = (
    f"https://{DATABRICKS_HOST}/serving-endpoints/"
    "databricks-meta-llama-3-3-70b-instruct/invocations"
)

print(f"GOLD input   : {cfg.GOLD_TABLE}")
print(f"IDP output   : {cfg.IDP_OUT_TABLE}")
print(f"TEST_MODE    : {cfg.TEST_MODE}")
print(f"MAX_WORKERS  : {cfg.MAX_WORKERS}")

# COMMAND ----------
# MAGIC %md ## 5 — Healthcare Knowledge Graph

# COMMAND ----------

PROCEDURE_TO_SPECIALTIES: Dict[str, List[str]] = {
    r"(?i)(c.?section|cesarean|episiotomy|laparotomy|hysterectomy|d&c|dilation)":
        ["gynecologyAndObstetrics", "generalSurgery"],
    r"(?i)(appendectomy|cholecystectomy|herniorrhaphy|colostomy|bowel\s+resection)":
        ["generalSurgery"],
    r"(?i)(amputation|fracture\s+fixation|osteotomy|hip\s+replacement|knee\s+replacement)":
        ["orthopedicSurgery", "generalSurgery"],
    r"(?i)(cataract|glaucoma|vitrectomy|retinal\s+surgery|ptosis\s+repair)":
        ["ophthalmology"],
    r"(?i)(tooth\s+extraction|root\s+canal|dental\s+filling|scaling|orthodontic)":
        ["dentistry"],
    r"(?i)(coronary|bypass\s+graft|valve\s+repair|open.?heart|cardiac\s+cath)":
        ["cardiacSurgery", "cardiology"],
    r"(?i)(craniotomy|ventriculostomy|laminectomy|spinal\s+fusion)":
        ["neurology"],
    r"(?i)(prostatectomy|nephrectomy|cystoscopy|ureteroscopy)":
        ["urology"],
    r"(?i)(gastrectomy|colonoscopy|endoscopy|liver\s+biopsy|esophagoscopy)":
        ["gastroenterology"],
    r"(?i)(mastectomy|breast\s+biopsy|lumpectomy)":
        ["generalSurgery"],
    r"(?i)(thyroidectomy|parathyroidectomy|adrenalectomy)":
        ["endocrinologyAndDiabetesAndMetabolism", "generalSurgery"],
    r"(?i)(skin\s+graft|flap\s+surgery|scar\s+revision)":
        ["plasticSurgery", "dermatology"],
    r"(?i)(dialysis|hemodialysis|peritoneal\s+dialysis|renal\s+replacement)":
        ["nephrology"],
    r"(?i)(chemotherapy|radiation\s+therapy|tumor\s+biopsy|bone\s+marrow)":
        ["medicalOncology"],
    r"(?i)(antenatal|postnatal|maternity|labour|delivery|midwifery|obstetric)":
        ["obstetricsAndMaternityCare", "gynecologyAndObstetrics"],
    r"(?i)(pmtct|antiretroviral|art\s+therapy|hiv\s+test|cd4\s+count)":
        ["infectiousDiseases", "internalMedicine"],
    r"(?i)(vaccination|immunization|epi\s+clinic|immunis)":
        ["pediatrics", "publicHealth"],
    r"(?i)(physiotherapy|rehabilitation|occupational\s+therapy)":
        ["physicalMedicineAndRehabilitation"],
    r"(?i)(ecg|electrocardiogram|echo\s+cardiogram|cardiac\s+monitoring)":
        ["cardiology"],
    r"(?i)(x.?ray|ct\s+scan|mri|ultrasound|mammography|fluoroscopy)":
        ["radiology"],
    r"(?i)(blood\s+test|cbc|urinalysis|blood\s+culture|pcr|lab\s+test)":
        ["pathology", "clinicalPathology"],
    r"(?i)(mental\s+health|psychiatric|counseling|psychotherapy|depression\s+screen)":
        ["psychiatry"],
    r"(?i)(family\s+planning|contraception|intrauterine|condom\s+dispensing)":
        ["familyPlanningAndComplexContraception", "gynecologyAndObstetrics"],
    r"(?i)(neonatal|incubator|kangaroo\s+care|nicu\s+admission)":
        ["neonatologyPerinatalMedicine", "pediatrics"],
    r"(?i)(dermatology|skin\s+biopsy|acne\s+treatment|fungal\s+screen)":
        ["dermatology"],
    r"(?i)(anesthesia|anaesthesia|spinal\s+block|epidural|sedation)":
        ["anesthesia"],
}

CAPABILITY_TO_SPECIALTIES: Dict[str, List[str]] = {
    r"(?i)(icu|intensive\s+care\s+unit|critical\s+care)": ["criticalCareMedicine"],
    r"(?i)(nicu|neonatal\s+intensive|special\s+care\s+baby)":
        ["neonatologyPerinatalMedicine", "pediatrics"],
    r"(?i)(emergency\s+care|trauma\s+bay|accident\s+&\s+emergency|a&e|casualty)":
        ["emergencyMedicine"],
    r"(?i)(hiv|art\s+clinic|pmtct|antiretroviral)": ["infectiousDiseases"],
    r"(?i)(dialysis\s+unit|renal\s+unit)": ["nephrology"],
    r"(?i)(surgical\s+theatre|operating\s+theatre|surgical\s+suite)":
        ["generalSurgery", "anesthesia"],
    r"(?i)(maternity\s+ward|obstetric\s+unit|labour\s+ward|delivery\s+suite)":
        ["obstetricsAndMaternityCare", "gynecologyAndObstetrics"],
    r"(?i)(paediatric\s+ward|paediatric\s+unit|children.?s\s+ward)": ["pediatrics"],
    r"(?i)(mental\s+health\s+unit|psychiatric\s+ward|psychi)": ["psychiatry"],
    r"(?i)(radiology\s+unit|imaging\s+center|x.?ray\s+unit)": ["radiology"],
    r"(?i)(blood\s+bank|transfusion\s+service)":
        ["pathology", "criticalCareMedicine"],
    r"(?i)(public\s+health\s+program|community\s+health|outreach)": ["publicHealth"],
}

NAME_TO_TIER: List[Tuple[re.Pattern, str, List[str]]] = [
    (re.compile(r"(?i)\bteaching\s+hospital\b"),
     "Academic/Teaching",
     ["generalSurgery", "internalMedicine", "pediatrics", "radiology", "pathology"]),
    (re.compile(r"(?i)\bregional\s+hospital\b"),
     "Regional/Referral",
     ["generalSurgery", "internalMedicine", "pediatrics", "emergencyMedicine"]),
    (re.compile(r"(?i)\bdistrict\s+hospital\b"),
     "District",
     ["generalSurgery", "internalMedicine", "emergencyMedicine"]),
    (re.compile(r"(?i)\bmilitary\s+hospital\b"),
     "Military",
     ["generalSurgery", "internalMedicine", "emergencyMedicine"]),
    (re.compile(r"(?i)\bspecialist\s+hospital\b|\bspecialist\s+clinic\b"),
     "Specialist", []),
    (re.compile(r"(?i)\bpolyclinic\b"),
     "Polyclinic", ["familyMedicine", "internalMedicine"]),
    (re.compile(r"(?i)\bchps\b"),
     "Primary/CHPS", ["familyMedicine", "publicHealth"]),
    (re.compile(r"(?i)\bclinic\b|\bhealth\s+center\b|\bhealth\s+centre\b|\bhealth\s+post\b"),
     "Primary/Clinic", ["familyMedicine"]),
    (re.compile(r"(?i)\bdentist|\bdental\b"),
     "Dental", ["dentistry"]),
    (re.compile(r"(?i)\beye\s+hospital\b|\boptical\b|\bophthalmol"),
     "Eye/Ophthalmology", ["ophthalmology"]),
    (re.compile(r"(?i)\bmaternity\b|\bwomen.?s\s+hospital\b"),
     "Maternity", ["obstetricsAndMaternityCare", "gynecologyAndObstetrics"]),
    (re.compile(r"(?i)\bmental\s+health\b|\bpsychiatric\b"),
     "Psychiatric", ["psychiatry"]),
]

FAITH_NAME_PATTERNS: List[Tuple[re.Pattern, List[str]]] = [
    (re.compile(r"(?i)\b(catholic|roman\s+catholic|holy|st\.\s+\w+|saint\s+\w+)\b"),
     ["faith-tradition"]),
    (re.compile(r"(?i)\b(methodist|presbyterian|sda|seventh.?day|adventist|baptist|anglican)\b"),
     ["faith-tradition"]),
    (re.compile(r"(?i)\b(islam|muslim|islamic|al.)\b"),
     ["faith-tradition"]),
    (re.compile(r"(?i)\b(mission|missionary|church)\b"),
     ["faith-tradition", "philanthropy-legacy"]),
    (re.compile(r"(?i)\b(ngo|foundation|trust|charity|charities|aid|relief)\b"),
     ["philanthropy-legacy"]),
]


@dataclass
class FacilityArchetype:
    name: str
    bed_range: Tuple[int, int]
    doctor_range: Tuple[int, int]
    expected_specialties: List[str]
    complexity: str
    typical_operator: str


FACILITY_ARCHETYPES: Dict[str, FacilityArchetype] = {
    "teaching_hospital": FacilityArchetype(
        "Teaching Hospital", (200, 800), (30, 120),
        ["generalSurgery", "internalMedicine", "pediatrics", "radiology",
         "pathology", "anesthesia", "emergencyMedicine", "gynecologyAndObstetrics"],
        "L4", "public"
    ),
    "regional_hospital": FacilityArchetype(
        "Regional Hospital", (100, 350), (10, 40),
        ["generalSurgery", "internalMedicine", "pediatrics", "emergencyMedicine",
         "gynecologyAndObstetrics"],
        "L3", "public"
    ),
    "district_hospital": FacilityArchetype(
        "District Hospital", (50, 200), (5, 20),
        ["generalSurgery", "internalMedicine", "emergencyMedicine",
         "obstetricsAndMaternityCare"],
        "L2", "public"
    ),
    "mission_hospital": FacilityArchetype(
        "Mission/Faith Hospital", (30, 150), (5, 25),
        ["generalSurgery", "internalMedicine", "obstetricsAndMaternityCare", "pediatrics"],
        "L2", "private"
    ),
    "polyclinic": FacilityArchetype(
        "Polyclinic", (20, 80), (3, 15),
        ["familyMedicine", "internalMedicine", "pediatrics"],
        "L2", "public"
    ),
    "clinic": FacilityArchetype(
        "Clinic / Health Centre", (5, 50), (1, 8),
        ["familyMedicine"],
        "L1", "private"
    ),
    "chps": FacilityArchetype(
        "CHPS Compound", (1, 5), (0, 2),
        ["familyMedicine", "publicHealth"],
        "L1", "public"
    ),
    "military_hospital": FacilityArchetype(
        "Military Hospital", (80, 300), (10, 50),
        ["generalSurgery", "internalMedicine", "emergencyMedicine", "pediatrics"],
        "L3", "public"
    ),
    "specialist_hospital": FacilityArchetype(
        "Specialist Hospital", (30, 200), (5, 30),
        [], "L3", "private"
    ),
    "ngo_clinic": FacilityArchetype(
        "NGO Clinic", (10, 80), (2, 15),
        ["familyMedicine", "publicHealth", "infectiousDiseases"],
        "L2", "private"
    ),
}


def get_archetype(row: Dict[str, Any]) -> Optional[FacilityArchetype]:
    name = safe_str(row.get("name", "")).lower()
    tier = safe_str(row.get("facility_tier_label", "")).lower()
    ftype = safe_str(row.get("facility_type_clean", "")).lower()
    is_ngo = row.get("is_ngo") is True
    is_military = row.get("is_military_hospital") is True
    is_teaching = row.get("is_teaching_hospital") is True
    is_referral = row.get("is_referral_center") is True

    if is_teaching or "teaching" in name or "teaching" in tier:
        return FACILITY_ARCHETYPES["teaching_hospital"]
    if is_military or "military" in name or "military" in tier:
        return FACILITY_ARCHETYPES["military_hospital"]
    if "regional" in name and "hospital" in name:
        return FACILITY_ARCHETYPES["regional_hospital"]
    if is_referral or "referral" in name:
        return FACILITY_ARCHETYPES["regional_hospital"]
    if "district" in name and "hospital" in name:
        return FACILITY_ARCHETYPES["district_hospital"]
    if "mission" in name or "catholic" in name or "methodist" in name or "presbyterian" in name:
        return FACILITY_ARCHETYPES["mission_hospital"]
    if "chps" in name:
        return FACILITY_ARCHETYPES["chps"]
    if "polyclinic" in name:
        return FACILITY_ARCHETYPES["polyclinic"]
    if is_ngo:
        return FACILITY_ARCHETYPES["ngo_clinic"]
    if ftype == "hospital" or "hospital" in name:
        return FACILITY_ARCHETYPES["regional_hospital"] if is_referral else FACILITY_ARCHETYPES["district_hospital"]
    if ftype in ("clinic", "doctor") or "clinic" in name or "health centre" in name:
        return FACILITY_ARCHETYPES["clinic"]
    return None


SOURCE_TRUST_TIERS: Dict[str, int] = {
    "hefra.gov.gh": 1, "moh.gov.gh": 1, "ghana.gov.gh": 1,
    "ghanahospitals.org": 2, "source_url_official": 2,
    "wikipedia": 3, "who.int": 3, "ngodirectory": 3,
    "duckduckgo": 4, "ddg_social_fallback": 5,
    "facebook.com": 6, "twitter.com": 6, "instagram.com": 6,
    "heuristic": 0, "archetype": 0, "kg_inference": 0,
}


def source_trust(tag: str) -> int:
    for domain, tier in SOURCE_TRUST_TIERS.items():
        if domain in tag:
            return tier
    return 4

# COMMAND ----------
# MAGIC %md ## 6 — Utility Helpers

# COMMAND ----------

def ensure_list(x) -> List[str]:
    if x is None:
        return []
    try:
        if isinstance(x, np.ndarray):
            return [str(v).strip() for v in x.tolist() if v is not None and str(v).strip()]
    except Exception:
        pass
    if isinstance(x, float):
        return []
    if isinstance(x, list):
        return [str(v).strip() for v in x if v is not None and str(v).strip() not in ("None", "nan", "null", "")]
    if isinstance(x, str):
        s = x.strip()
        if not s or s in ("null", "[]", "nan", "None", ""):
            return []
        if '""' in s:
            s = s.replace('""', '"')
        if s.startswith('"[') and s.endswith(']"'):
            s = s[1:-1]
        try:
            p = json.loads(s)
            if isinstance(p, list):
                return [str(v).strip() for v in p if v is not None and str(v).strip()]
            return [str(p).strip()] if str(p).strip() else []
        except Exception:
            if "," in s and not s.startswith("{"):
                return [t.strip().strip('"').strip("'") for t in s.split(",") if t.strip()]
            return [s] if len(s) >= 3 else []
    return [str(x).strip()] if str(x).strip() else []


def safe_str(val, default: str = "") -> str:
    if val is None:
        return default
    try:
        if isinstance(val, np.ndarray):
            return " ".join(
                str(v).strip() for v in val.tolist()
                if v is not None and str(v).strip() not in ("None", "nan", "null", "")
            )
    except Exception:
        pass
    try:
        if isinstance(val, (pd.Series, pd.Index)):
            return " ".join(
                str(v).strip() for v in val.tolist()
                if v is not None and str(v).strip() not in ("None", "nan", "null", "")
            )
        if pd.isna(val):
            return default
    except (TypeError, ValueError):
        pass
    if isinstance(val, (list, tuple)):
        return " ".join(
            str(v).strip() for v in val
            if v is not None and str(v).strip() not in ("None", "nan", "null")
        )
    if isinstance(val, float) and math.isnan(val):
        return default
    s = str(val).strip()
    return default if s in ("None", "nan", "null", "", "[]", "{}") else s


def safe_float(val, default=None):
    if val is None:
        return default
    try:
        v = float(str(val).strip())
        return v if v == v else default
    except Exception:
        return default


def safe_int(val, default=None):
    if val is None:
        return default
    try:
        m = re.search(r"\d+", str(val).strip())
        return int(m.group()) if m else default
    except Exception:
        return default


_POSTAL_ADDRESS_RE = re.compile(r"(?i)\b(?:p\.?\s*o\.?\s*box|pmb)\s*([\w\-/]+(?:\s+[\w\-/]+)?)")


def _normalize_postal_address_text(val: Any) -> Optional[str]:
    text = safe_str(val)
    if not text:
        return None
    postal_match = _POSTAL_ADDRESS_RE.search(text)
    if postal_match:
        prefix_match = re.search(r"(?i)(p\.?\s*o\.?\s*box|pmb)", text)
        if prefix_match:
            cleaned = text[prefix_match.start():postal_match.end()]
        else:
            cleaned = postal_match.group(0)
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,;:-")
        return cleaned if cleaned else None
    return None


def is_null_or_empty(val) -> bool:
    if val is None:
        return True
    if isinstance(val, float) and math.isnan(val):
        return True
    s = str(val).strip()
    return s in ("", "None", "nan", "null", "[]", "{}", "not_extracted", "unknown", "NaN", "NaT")


def dedup_list(items: List[str]) -> List[str]:
    seen, out = set(), []
    for item in items:
        key = re.sub(r"[^\w\s]", "", item.lower())
        key = re.sub(r"\s+", " ", key).strip()
        if key and key not in seen and len(key) >= 4:
            seen.add(key)
            out.append(item)
    return out


def truncate_items(items: List[str], min_len: int = 10, max_len: int = 300) -> List[str]:
    return [s[:max_len] for s in items if s and len(s.strip()) >= min_len]


def parse_json_llm(text: str) -> Any:
    if not text:
        return {}
    if isinstance(text, list):
        text = "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in text)
    elif not isinstance(text, str):
        text = str(text)
    clean = re.sub(r"```(?:json)?\s*", "", text)
    clean = re.sub(r"```", "", clean).strip()
    clean = re.sub(r",\s*([}\]])", r"\1", clean)
    try:
        return json.loads(clean)
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", clean)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    m2 = re.search(r"\[[\s\S]*\]", clean)
    if m2:
        try:
            return json.loads(m2.group())
        except Exception:
            pass
    return {}


def normalise_row_keys(row_d: Dict[str, Any]) -> Dict[str, Any]:
    for camel, lower in _PYDANTIC_TO_DELTA.items():
        if camel in row_d and camel != lower:
            camel_val = row_d.pop(camel)
            if is_null_or_empty(row_d.get(lower)):
                row_d[lower] = camel_val
    return row_d


# I16: Strict E164 normalisation — Ghana only
def _normalise_phone_e164(raw: str) -> Optional[str]:
    """
    Return E164 Ghana phone (+233XXXXXXXXX) or None.
    Schema doc: officialPhone must be in E164 format e.g. '+233392022664'.
    Rejects non-Ghana numbers.
    """
    if not raw:
        return None
    if "/" in raw:
        raw = raw.split("/")[0].strip()
    clean = re.sub(r"[^\d+]", "", raw)
    # Pattern: 0XXXXXXXXX (10 digits, local)
    if re.fullmatch(r"0\d{9}", clean):
        return "+233" + clean[1:]
    # Pattern: +233XXXXXXXXX
    if re.fullmatch(r"\+233\d{9}", clean):
        return clean
    # Pattern: 233XXXXXXXXX
    if re.fullmatch(r"233\d{9}", clean):
        return "+" + clean
    # Pattern: +233 (0) XXXXXXXXX
    m = re.search(r"\+?233\s*(?:\(0\))?\s*(\d{9})", raw)
    if m:
        return "+233" + m.group(1)
    return None


# I16: Domain-only website extraction
def _extract_domain_only(raw: str) -> Optional[str]:
    """
    Return domain only from a URL — e.g. 'korlebu.gov.gh' not 'https://korlebu.gov.gh/about'.
    Schema doc: officialWebsite = domain name only, not full URL.
    """
    if not raw:
        return None
    s = raw.strip()
    if not s.startswith("http"):
        s = "https://" + s
    try:
        parsed = urlparse(s)
        domain = parsed.netloc.lstrip("www.")
        if domain and "." in domain and len(domain) > 3:
            # Skip social media — not official website
            if any(sm in domain for sm in ["facebook.com", "twitter.com", "instagram.com",
                                            "linkedin.com", "youtube.com", "tiktok.com"]):
                return None
            return domain
    except Exception:
        pass
    return None

# COMMAND ----------
# MAGIC %md ## 7 — Clinical Junk Filter (v11 enhanced)

# COMMAND ----------

# I13: Extended junk patterns — strictly exclude non-clinical content from procedure/equipment/capability
_JUNK_PATTERNS = [
    # Location / address
    re.compile(r"(?i)^located\s+(at|in|along|near|behind|opposite|beside|on)\b"),
    re.compile(r"(?i)^p\.?\s*o\.?\s*box\s+\d"),
    re.compile(r"(?i)\bGPS\s+(address|code|location|coordinate)"),
    re.compile(r"(?i)^address\s*:"),
    re.compile(r"(?i)(\bstreet\b|\broad\b|\bavenue\b|\blane\b).*(\baccra\b|\bkumasi\b|\btakoradi\b)", re.I),
    # Phone / contact
    re.compile(r"(?i)^phone\s*(number|contact)?\s*[:\-]"),
    re.compile(r"(?i)telephone\s+numbers?\s+(?:are|is)"),
    re.compile(r"^\+\d{6,}"),
    re.compile(r"^[\d\s\+\-\(\)\.]{8,}$"),
    re.compile(r"(?i)\b\+233\d"),
    re.compile(r"(?i)^call\s+us"),
    # URLs / social media
    re.compile(r"(?i)(http[s]?://|www\.\w+\.\w+)"),
    re.compile(r"(?i)(facebook|instagram|twitter|whatsapp|linkedin|youtube|tiktok)\b"),
    # Business hours / operational (not clinical capability)
    re.compile(r"(?i)^always\s+open\.?$"),
    re.compile(r"(?i)^open\s+24\s+hours"),
    re.compile(r"(?i)offers?\s+24.hour\s+medical\s+services?\s*\(always\s+open\)"),
    re.compile(r"(?i)^(opening|business)\s+hours?\s*:"),
    re.compile(r"(?i)\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[\s\-–]\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b"),
    re.compile(r"(?i)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(to|-)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)"),
    # Administrative accreditation — not clinical capability
    re.compile(r"(?i)NHIS\s+(accredited|accreditation|registered)\b"),
    re.compile(r"(?i)^nhis\b"),
    # Ownership / registration — not clinical
    re.compile(r"(?i)^(public|private|government|faith.based)\s+(hospital|clinic|facility)\b"),
    re.compile(r"(?i)(registered|incorporated|licensed)\s+(under|with|by)\s+(ghana|ghs|hefra|ministry)"),
    # Pricing / payment
    re.compile(r"(?i)(accepts?\s+(cash|insurance|nhis|credit\s+card|mobile\s+money))"),
    re.compile(r"(?i)(consultation\s+fee|service\s+charge|payment\s+plan)"),
    # Web UI chrome
    re.compile(r"(?i)^listed\s+(in|on|as)\s+"),
    re.compile(r"(?i)listed\s+as\s+a\s+related\s+place"),
    re.compile(r"(?i)\d+\s+(people\s+)?(like|follow|check.?in|visit)"),
    re.compile(r"(?i)ghanabusinessweb|ghanayello|yellow\s+pages\b"),
    # Founding date as standalone statement — not a capability
    re.compile(r"(?i)^established\s+in\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|early|late)?\s*\d{4}\.?$"),
    re.compile(r"(?i)^founded\s+in\s+\d{4}\.?$"),
    # Employee counts as general statements
    re.compile(r"(?i)^has\s+\d+[-–]\d+\s+employees?"),
    # LLM reasoning leakage
    re.compile(
        r"(?i)(wait[\s,\-]|i should|we should|let me|based on the|analyzing|"
        r"note:|however,|this is a|actually,|i'll|please note|disclaimer|"
        r"according to|as mentioned|the text states|i cannot)"
    ),
    # Referral language (service classification, not capability)
    re.compile(r"(?i)(we\s+can\s+arrange|we\s+collaborate|we\s+send\s+to|refer\s+patients?\s+to)"),
]

_CLINICAL_HINT_RE = re.compile(
    r"""(?ix)\b(
    surgery|surgical|operation|procedure|cesarean|c[-\s]?section|biopsy|
    transplant|amputation|dialysis|hemodialysis|chemotherapy|radiotherapy|
    endoscopy|colonoscopy|laparoscopy|intubation|ventilation|resuscitation|
    cpr|sutures?|catheterization|angiography|physiotherapy|rehabilitation|
    blood\s?test|cbc|urinalysis|lab\s?test|ecg|ekg|electrocardiogram|
    imaging|radiology|x[-\s]?ray|ct\s?scan|mri|ultrasound|mammography|
    emergency|casualty|trauma|icu|intensive\s+care|nicu|hdu|ccu|ventilator|
    life\s?support|critical\s+care|maternity|obstetric|antenatal|postnatal|
    labour|delivery|midwifery|pediatric|paediatric|child\s+health|neonatal|
    inpatient|outpatient|admission|ward|treatment|therapy|clinical|
    operating\s+theatre|surgical\s+theatre|oxygen|generator|ambulance|
    bed\s+capacity|icu\s+beds?|hospital\s+beds?|monitor|defibrillator|
    laboratory|lab|hiv|aids|tb|tuberculosis|malaria|diabetes|hypertension|
    cardiac|cardiology|heart|stroke|neurology|cancer|oncology|infectious|
    disease|mental|psychiatric|depression|radiology|pathology|orthopaedic|
    orthopedic|gynecology|gynaecology|pediatrics|paediatrics|ophthalmology|
    dentistry|dermatology|urology|nephrology|dialysis|renal|pharmacy|
    dispensary|vaccination|immunization|blood\s+bank|mortuary|pmtct|
    antiretroviral|art\b|chps|polyclinic|district\s+hospital|
    regional\s+hospital|teaching\s+hospital|specialist\s+hospital|
    anesthesia|anaesthesia|transfusion|phlebotomy|biopsy|colposcopy|
    episiotomy|laparotomy|appendectomy|cholecystectomy|herniorrhaphy|
    mastectomy|prostatectomy|hysterectomy|nephrectomy|thoracotomy
    )\b""",
    re.IGNORECASE,
)

# I21: Declarative statement pattern — items should be clear declarative facts
_DECLARATIVE_RE = re.compile(
    r"(?i)^(performs?|offers?|provides?|conducts?|equipped\s+with|has\s+a?n?\s+|"
    r"operates?|delivers?|capable\s+of|designated\s+as|accredited\s+for|"
    r"specialises?\s+in|treats?|manages?|serves?)",
)


def is_junk(text: str) -> bool:
    if not text:
        return True
    s = str(text).strip()
    if len(s) < cfg.MIN_ITEM_LEN or len(s) > cfg.MAX_ITEM_LEN:
        return True
    if re.fullmatch(r"[\d\s\+\-\(\)\.]+", s):
        return True
    return any(p.search(s) for p in _JUNK_PATTERNS)


def clean_clinical_array(items) -> List[str]:
    return dedup_list(truncate_items([
        str(item).strip() for item in ensure_list(items)
        if not is_junk(str(item).strip())
    ]))


def clean_capability_strict(items) -> List[str]:
    out = []
    for item in ensure_list(items):
        s = str(item).strip()
        if is_junk(s):
            continue
        if not _CLINICAL_HINT_RE.search(s):
            if not re.search(
                r"(?i)(24.hour|level\s+[IVX\d]+|designated|accredited|"
                r"inpatient|outpatient|referral|beds?\s+\(|\d+\s+beds?)", s
            ):
                continue
        out.append(s)
    return dedup_list(truncate_items(out))


# I21: Enforce declarative statement style for free-form items
def _ensure_declarative(item: str, field_type: str) -> str:
    """
    Ensure extracted clinical items are clear declarative statements.
    If item lacks a declarative verb, prefix with appropriate verb.
    """
    s = item.strip()
    if not s:
        return s
    if _DECLARATIVE_RE.match(s):
        return s
    # Already starts with a noun-phrase about a device/unit — acceptable
    if re.match(r"(?i)^(ct\s+scan|mri|x.?ray|ultrasound|icu|nicu|hdu|operating|surgical|maternity|emergency)", s):
        if field_type == "equipment":
            return f"Equipped with {s}"
        elif field_type == "capability":
            return f"Operates {s}"
        return s
    # Short noun phrase — wrap as declarative
    if len(s) < 60 and not re.search(r"[.!?]", s):
        if field_type == "procedure":
            return f"Performs {s}"
        elif field_type == "equipment":
            return f"Equipped with {s}"
        elif field_type == "capability":
            return f"Provides {s}"
    return s


def apply_declarative_style(items: List[str], field_type: str) -> List[str]:
    return [_ensure_declarative(i, field_type) for i in items if i]

# COMMAND ----------
# MAGIC %md ## 8 — SharedEvidence + FieldProvenance + PlanningCompleteness

# COMMAND ----------

# I19: Field completeness status
FieldStatus = Literal["verified", "inferred", "missing"]


@dataclass
class FieldCompleteness:
    """Per-field completeness status for planning layer (I19)."""
    field_name: str
    df_col: str
    status: FieldStatus   # "verified" | "inferred" | "missing"
    source: Optional[str]
    confidence: float
    fill_method: Optional[str]  # "web_extracted" | "llm_inferred" | "archetype" | "deterministic" | "input"


@dataclass
class FieldProvenance:
    """Structured provenance for a single enriched field."""
    value: Any
    source: str
    confidence: float
    method: str
    snippet: str
    trust_tier: int
    phase_id: str = ""   # I15: which pipeline phase produced this

    def to_dict(self) -> Dict:
        return {
            "value": self.value,
            "source": self.source,
            "confidence": round(self.confidence, 3),
            "method": self.method,
            "snippet": self.snippet[:120],
            "trust_tier": self.trust_tier,
            "phase_id": self.phase_id,
        }


@dataclass
class SharedEvidence:
    """Built once per row, shared across all phases."""
    procedures_clean: List[str] = field(default_factory=list)
    equipment_clean: List[str] = field(default_factory=list)
    capabilities_clean: List[str] = field(default_factory=list)
    valid_specialties: List[str] = field(default_factory=list)

    clinical_text: str = ""
    compact_context: str = ""
    web_evidence_text: str = ""

    web_facts: Dict[str, List[FieldProvenance]] = field(default_factory=lambda: defaultdict(list))

    web_description: Optional[str] = None
    web_phone: Optional[str] = None
    web_email: Optional[str] = None
    web_beds: Optional[int] = None
    web_doctors: Optional[int] = None
    web_year: Optional[int] = None
    web_website: Optional[str] = None
    web_services: List[str] = field(default_factory=list)
    web_snippets: List[str] = field(default_factory=list)
    sources_used: List[str] = field(default_factory=list)

    evidence_score: float = 0.0
    critical_completeness: float = 0.0
    facility_name: str = ""

    # I15: Step-level citation log
    step_citations: List[Dict[str, Any]] = field(default_factory=list)
    # I19: Planning completeness layer
    field_completeness: List[FieldCompleteness] = field(default_factory=list)

    def log_step(self, phase_id: str, field_name: str, value: Any,
                 source: str, method: str, snippet: str = ""):
        """I15: Log a step-level citation entry."""
        self.step_citations.append({
            "phase_id": phase_id,
            "field": field_name,
            "value": str(value)[:80] if value is not None else None,
            "source": source,
            "method": method,
            "snippet": snippet[:100],
            "timestamp_ms": int(time.time() * 1000),
        })

    def best_value(self, field_name: str) -> Optional[FieldProvenance]:
        provs = self.web_facts.get(field_name, [])
        if not provs:
            return None
        return min(provs, key=lambda p: p.trust_tier)

    def reconcile(self, field_name: str) -> Optional[Any]:
        provs = self.web_facts.get(field_name, [])
        if not provs:
            return None
        if len(provs) == 1:
            return provs[0].value
        if field_name == "description":
            valid = [p for p in provs if p.method == "semantic_summary_extraction"]
            if valid:
                valid = sorted(valid, key=lambda p: (p.trust_tier, -len(str(p.value))))
                return valid[0].value
        sorted_provs = sorted(provs, key=lambda p: p.trust_tier)
        top_trust = sorted_provs[0].trust_tier
        top_tier_values = [p.value for p in sorted_provs if p.trust_tier == top_trust]
        if len(top_tier_values) == 1:
            return top_tier_values[0]
        if all(isinstance(v, (int, float)) for v in top_tier_values):
            return sorted(top_tier_values)[len(top_tier_values) // 2]
        return top_tier_values[0]

    def add_evidence(self, field_name: str, value: Any, source: str,
                     confidence: float, method: str, snippet: str,
                     phase_id: str = ""):
        if is_null_or_empty(value):
            return
        prov = FieldProvenance(
            value=value, source=source, confidence=confidence,
            method=method, snippet=snippet[:120], trust_tier=source_trust(source),
            phase_id=phase_id,
        )
        self.web_facts[field_name].append(prov)

    def compute_critical_completeness(self, row: Dict[str, Any]) -> float:
        weights = {
            "number_doctors": 0.20,
            "capacity":        0.20,
            "description":     0.15,
            "official_phone":  0.15,
            "email":           0.10,
            "website":         0.10,
            "year_established": 0.10,
        }
        score = 0.0
        for canonical, weight in weights.items():
            spec = FIELD_REGISTRY.get(canonical)
            if spec:
                val_in_row = row.get(spec.df_col)
                if not is_null_or_empty(val_in_row):
                    score += weight
        return min(1.0, score)

    def commit_reconciled_values(self, row: Dict[str, Any]) -> Dict[str, Any]:
        committed: Dict[str, Any] = {}
        for canonical, spec in FIELD_REGISTRY.items():
            df_col = spec.df_col
            if not is_null_or_empty(row.get(df_col)):
                continue
            val = self.reconcile(canonical)
            if val is None:
                continue
            if spec.dtype == "integer":
                try:
                    v = int(val)
                except Exception:
                    continue
                committed[df_col] = v
                row[df_col] = v
            elif spec.dtype == "boolean":
                if isinstance(val, bool):
                    committed[df_col] = val
                    row[df_col] = val
                else:
                    sval = str(val).strip().lower()
                    if sval in ("true", "1", "yes"):
                        committed[df_col] = True
                        row[df_col] = True
                    elif sval in ("false", "0", "no"):
                        committed[df_col] = False
                        row[df_col] = False
            elif spec.canonical == "official_phone":
                # I16: E164 enforcement
                norm = _normalise_phone_e164(str(val))
                if norm:
                    committed[df_col] = norm
                    row[df_col] = norm
            elif spec.canonical == "website":
                # I16: domain-only
                domain = _extract_domain_only(str(val))
                if domain:
                    committed[df_col] = domain
                    row[df_col] = domain
            elif spec.canonical == "postal_address":
                postal = _normalize_postal_address_text(val)
                if postal:
                    committed[df_col] = postal
                    row[df_col] = postal
            else:
                s = str(val).strip()
                if s:
                    committed[df_col] = s
                    row[df_col] = s
        return committed

# COMMAND ----------
# MAGIC %md ## 9 — Web Enrichment

# COMMAND ----------

_WEB_SESSION = requests.Session()
_WEB_SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
})
_SCRAPED_CACHE: Dict[str, Optional[str]] = {}
_SCRAPED_CACHE_LOCK = threading.Lock()


def _fetch_url(url: str, timeout: int = cfg.WEB_TIMEOUT) -> Optional[str]:
    if not url or not url.startswith("http"):
        return None
    url = url.strip()
    with _SCRAPED_CACHE_LOCK:
        if url in _SCRAPED_CACHE:
            return _SCRAPED_CACHE[url]
    try:
        resp = _WEB_SESSION.get(url, timeout=timeout, allow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header", "form",
                         "noscript", "svg", "iframe"]):
            tag.decompose()
        text = re.sub(r"\s{2,}", " ", soup.get_text(separator=" ", strip=True)).strip()
        result = text[:7000]
        with _SCRAPED_CACHE_LOCK:
            _SCRAPED_CACHE[url] = result
        time.sleep(cfg.SLEEP_WEB)
        return result
    except Exception:
        with _SCRAPED_CACHE_LOCK:
            _SCRAPED_CACHE[url] = None
        return None


# I23: Improved description extraction — no web chrome, concise factual paragraph
_DESC_BLACKLIST_EXACT = {
    "contact us", "home", "categories", "listing", "services", "specialist fields",
    "ownership", "nhis accredited", "health insurance", "welcome to", "click here",
    "read more", "all rights reserved", "privacy policy", "terms of use", "follow us",
    "opening hours", "always open", "business hours", "book appointment", "directions",
    "share", "login", "register", "search", "menu", "navigation", "sitemap",
}

_DESC_BAD_PATTERNS = [
    re.compile(r"(?i)contact\s+us"),
    re.compile(r"(?i)all\s+rights\s+reserved"),
    re.compile(r"(?i)privacy\s+policy"),
    re.compile(r"(?i)terms\s+of\s+(service|use)"),
    re.compile(r"(?i)copyright\s+\d{4}"),
    re.compile(r"(?i)follow\s+us\s+on"),
    re.compile(r"(?i)book\s+an?\s+appointment"),
    re.compile(r"(?i)click\s+here"),
    re.compile(r"(?i)home\s*>"),
    re.compile(r"(?i)categories?"),
    re.compile(r"(?i)directory\s+listing"),
    re.compile(r"(?i)navigation"),
    re.compile(r"(?i)^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)"),
    re.compile(r"(?i)\+233\d"),  # phone number
    re.compile(r"(?i)p\.?\s*o\.?\s*box"),  # postal address
    re.compile(r"(?i)accra|kumasi|takoradi\s+(road|street|avenue|lane)"),  # street address
]

_MEDICAL_SUMMARY_HINTS = re.compile(
    r"""(?ix)(hospital|clinic|medical|healthcare|tertiary|referral|specialist|
    emergency|inpatient|outpatient|maternity|surgery|teaching|diagnostic|
    rehabilitation|mental\s+health|trauma|cardiology|pediatric|paediatric|
    oncology|radiology|laboratory|intensive\s+care|district\s+hospital|
    regional\s+hospital|health\s+centre|health\s+center|health\s+facility)"""
)


def _clean_summary_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    lower = text.lower()
    for bword in _DESC_BLACKLIST_EXACT:
        if lower == bword:
            return ""
    for pat in _DESC_BAD_PATTERNS:
        if pat.search(text):
            return ""
    junk_ratio = len(re.findall(r"\b(home|contact|listing|category|menu|navigation)\b", text, re.I))
    if junk_ratio >= 3:
        return ""
    if len(text) < 40:
        return ""
    # I23: Reject raw UI text dumps
    if len(text) > 800:
        return ""
    pipe_density = text.count("|") / max(len(text), 1)
    if pipe_density > 0.02:
        return ""
    return text


def _extract_best_medical_summary(text: str, facility_name: str) -> Optional[str]:
    """
    I23: Extract best concise factual summary from webpage text.
    Schema doc: description = brief paragraph about services and/or history.
    Rejects contact info, hours, navigation chrome.
    """
    if not text:
        return None
    paragraphs = re.split(r"\n+|\.\s+", text)
    candidates = []
    for para in paragraphs:
        para = _clean_summary_text(para)
        if not para:
            continue
        score = 0
        if _MEDICAL_SUMMARY_HINTS.search(para):
            score += 5
        if facility_name and facility_name.lower() in para.lower():
            score += 4
        if 60 <= len(para) <= 350:
            score += 3
        elif 40 <= len(para) < 60:
            score += 1
        if len(re.findall(r"\b(home|contact|listing|menu|category)\b", para, re.I)) > 1:
            score -= 5
        if para.count("|") > 2:
            score -= 3
        if para.count(">") > 1:
            score -= 3
        # Bonus for clinical content
        clinical_hits = len(_CLINICAL_HINT_RE.findall(para))
        score += min(clinical_hits * 2, 8)
        candidates.append((score, para))

    if not candidates:
        return None
    candidates.sort(reverse=True, key=lambda x: x[0])
    best_score, best = candidates[0]
    if best_score < 2:
        return None
    best = re.sub(r"\s+", " ", best).strip(" -|>")
    if len(best) > 400:
        best = best[:400].rsplit(" ", 1)[0]
    return best if len(best) >= 40 else None


def _extract_facts_expanded(text: str, source_tag: str, ev: SharedEvidence,
                             phase_id: str = "p_web"):
    """Expanded extraction from web page text."""
    if not text:
        return
    t = safe_str(text)
    facility_name = ev.facility_name

    # I23: Intelligent description extraction
    summary = _extract_best_medical_summary(t, facility_name)
    if summary:
        ev.add_evidence("description", summary, source_tag, 0.90,
                        "semantic_summary_extraction", summary[:120], phase_id)
        ev.log_step(phase_id, "description", summary[:80], source_tag,
                    "semantic_summary_extraction", summary[:80])

    # Bed capacity
    bed_patterns = [
        r"(\d{1,4})\s*[-\s]?(?:bed|inpatient|capacity|room)s?\b",
        r"bed\s+strength[\s:]+(\d{1,4})",
        r"(\d{1,4})[-\s]?bed\s+(?:facility|hospital|centre|center)",
        r"inpatient\s+capacity[\s:]+(\d{1,4})",
        r"(?:accommodates?|admits?)\s+(\d{1,4})\s+patients?",
        r"(\d{1,4})\s+inpatient\s+(?:beds?|spaces?|accommodation)",
    ]
    for pat in bed_patterns:
        m = re.search(pat, t, re.I)
        if m:
            v = int(m.group(1))
            if 5 <= v <= 5000:
                snip = f"...{t[max(0, m.start()-20):m.end()+20]}..."
                ev.add_evidence("capacity", v, source_tag, 0.80, "regex", snip, phase_id)
                ev.log_step(phase_id, "capacity", v, source_tag, "regex", snip[:60])
                break

    # Doctor count
    doc_patterns = [
        r"(\d{1,3})\s*(?:medical\s+)?(?:doctors?|physicians?|specialists?|consultants?)\b",
        r"(\d{1,3})\s+(?:medical\s+)?(?:staff|workers?|clinicians?)\b",
        r"medical\s+staff[\s:]+(\d{1,3})",
        r"(\d{1,3})\s+full.?time\s+(?:doctors?|physicians?|medical)",
    ]
    for pat in doc_patterns:
        m = re.search(pat, t, re.I)
        if m:
            v = int(m.group(1))
            if 1 <= v <= 500:
                snip = f"...{t[max(0, m.start()-20):m.end()+20]}..."
                ev.add_evidence("number_doctors", v, source_tag, 0.75, "regex", snip, phase_id)
                ev.log_step(phase_id, "number_doctors", v, source_tag, "regex", snip[:60])
                break

    # Phone — I16: E164 only
    phone_pats = [
        r"\+233[\d\s\-\.]{7,12}",
        r"\b0\d{2}[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b",
        r"\b233\d{9}\b",
    ]
    for pat in phone_pats:
        m = re.search(pat, t)
        if m:
            raw = m.group(0).strip()
            normed = _normalise_phone_e164(raw)
            if normed:
                ev.add_evidence("official_phone", normed, source_tag, 0.85, "regex", raw, phase_id)
                ev.log_step(phase_id, "official_phone", normed, source_tag, "regex", raw)
                break

    # Email
    m = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", t)
    if m:
        ev.add_evidence("email", m.group(0), source_tag, 0.90, "regex", m.group(0), phase_id)

    # Year established
    year_patterns = [
        r"(?:founded|established|commissioned|opened|built|started|launched|since|from)\s+(?:in\s+)?(\d{4})\b",
        r"\b(\d{4})\s+(?:founding|establishment|opening)\b",
    ]
    for pat in year_patterns:
        m = re.search(pat, t, re.I)
        if m:
            yr = int(m.group(1))
            if 1850 <= yr <= 2026:
                snip = f"...{t[max(0, m.start()-15):m.end()+15]}..."
                ev.add_evidence("year_established", yr, source_tag, 0.70, "regex", snip, phase_id)
                ev.log_step(phase_id, "year_established", yr, source_tag, "regex", snip[:60])
                break

    # Website — I16: domain only
    m = re.search(r"(https?://[\w\-\.]+\.(?:com|org|gov|net|gh|edu)[/\w\-\.?=&%]*)", t)
    if m:
        domain = _extract_domain_only(m.group(1))
        if domain:
            ev.add_evidence("website", domain, source_tag, 0.65, "regex_domain", domain[:60], phase_id)

    # Postal address
    addr_candidates = [
        r"(?i)(p\.?\s*o\.?\s*box\s*\d+[A-Za-z0-9\-\s]*)",
        r"(?i)(pmb\s*\d+[A-Za-z0-9\-\s]*)",
    ]
    for pat in addr_candidates:
        m = re.search(pat, t)
        if m:
            addr = m.group(1).strip()
            if len(addr) >= 8:
                postal_only = _normalize_postal_address_text(addr)
                if postal_only:
                    ev.add_evidence("postal_address", postal_only[:180], source_tag, 0.58, "regex", postal_only[:80], phase_id)
                break

    # NGO: mission statement
    mission_m = re.search(
        r"(?i)(?:our\s+mission|mission\s+statement)\s*[:\-]?\s*(.{40,400})", t
    )
    if mission_m:
        mission_txt = mission_m.group(1).strip()
        if len(mission_txt) >= 30:
            ev.add_evidence("mission_statement", mission_txt[:400], source_tag, 0.65,
                            "regex_mission", mission_txt[:80], phase_id)

    # Volunteer acceptance
    if re.search(r"(?i)(volunteer|volunteering|join\s+our\s+team|we\s+accept\s+volunteers?)", t):
        ev.add_evidence("accepts_volunteers", True, source_tag, 0.70,
                        "regex_volunteer", "volunteer mention found", phase_id)

    # Services snippets
    svc_m = re.findall(r"(?i)(?:services?|specialties?|departments?)\s*[:\-]\s*([^\n\.;]{10,80})", t)
    if svc_m:
        ev.web_services.extend(s.strip() for s in svc_m[:4])
    ev.web_snippets.append(t[:200])


def _search_wikipedia(query: str) -> Optional[str]:
    try:
        resp = _WEB_SESSION.get(
            f"https://en.wikipedia.org/w/api.php?action=query&list=search"
            f"&srsearch={quote_plus(query)}&format=json&srlimit=1&srprop=snippet",
            timeout=cfg.WEB_TIMEOUT,
        )
        hits = resp.json().get("query", {}).get("search", [])
        if not hits:
            return None
        resp2 = _WEB_SESSION.get(
            f"https://en.wikipedia.org/w/api.php?action=query&prop=extracts"
            f"&exintro&explaintext&titles={quote_plus(hits[0]['title'])}&format=json",
            timeout=cfg.WEB_TIMEOUT,
        )
        for page in resp2.json().get("query", {}).get("pages", {}).values():
            extract = page.get("extract", "")
            if extract and len(extract) > 80 and (
                "Ghana" in extract or "Accra" in extract or "Kumasi" in extract
            ):
                return extract[:2000]
    except Exception:
        pass
    return None


def _search_duckduckgo(query: str, max_results: int = 3) -> List[str]:
    try:
        resp = _WEB_SESSION.get(
            f"https://html.duckduckgo.com/html/?q={quote_plus(query)}",
            timeout=cfg.WEB_TIMEOUT,
        )
        soup = BeautifulSoup(resp.text, "lxml")
        return [
            r.get_text(strip=True)
            for r in soup.select(".result__snippet")[:max_results]
            if len(r.get_text(strip=True)) > 20
        ]
    except Exception:
        return []


def _search_duckduckgo_results(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    try:
        resp = _WEB_SESSION.get(
            f"https://html.duckduckgo.com/html/?q={quote_plus(query)}",
            timeout=cfg.WEB_TIMEOUT,
        )
        soup = BeautifulSoup(resp.text, "lxml")
        results: List[Dict[str, str]] = []
        for item in soup.select(".result")[:max_results * 2]:
            a = item.select_one(".result__a")
            sn = item.select_one(".result__snippet")
            if not a:
                continue
            raw_href = a.get("href", "")
            parsed = urlparse(raw_href)
            url = raw_href
            if parsed.path.startswith("/l/"):
                qs = parse_qs(parsed.query)
                uddg = qs.get("uddg", [""])[0]
                if uddg:
                    url = unquote(uddg)
            if not url.startswith("http"):
                continue
            snippet = sn.get_text(" ", strip=True) if sn else ""
            title = a.get_text(" ", strip=True)
            results.append({"url": url[:500], "title": title[:200], "snippet": snippet[:400]})
            if len(results) >= max_results:
                break
        return results
    except Exception:
        return []


def _add_name_based_web_fallback(row: Dict[str, Any], ev: SharedEvidence):
    name = safe_str(row.get("name"))
    if not name:
        return
    city = safe_str(row.get("city_clean") or row.get("address_city"))
    region = safe_str(row.get("region_normalised") or row.get("address_stateOrRegion"))

    missing_social = any(
        is_null_or_empty(row.get(col))
        for col in ["facebooklink", "twitterlink", "linkedinlink", "instagramlink", "logo"]
    )
    missing_website = is_null_or_empty(row.get("officialWebsite"))
    missing_volunteer = is_null_or_empty(row.get("accepts_volunteers_bool"))
    missing_address = any(
        is_null_or_empty(row.get(col))
        for col in ["address_line1", "address_city", "address_stateOrRegion", "organizationdescription"]
    )
    if not (missing_social or missing_website or missing_volunteer or missing_address):
        return

    queries = [
        f'"{name}" {city} {region} Ghana hospital clinic official website contact address',
    ]
    if missing_social:
        queries.extend([
            f'site:facebook.com "{name}" {city} {region} Ghana',
            f'site:linkedin.com "{name}" {city} {region} Ghana',
        ])
    if missing_website:
        queries.append(f'"{name}" official website Ghana')

    results: List[Dict[str, str]] = []
    seen_urls: set = set()
    for query in queries:
        for result in _search_duckduckgo_results(query, max_results=6):
            url = safe_str(result.get("url"))
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            results.append(result)

    src_url = safe_str(row.get("source_url"))
    if src_url:
        low_src = src_url.lower()
        if "facebook.com" in low_src:
            ev.add_evidence("facebook_link", src_url, "source_url_social", 0.95,
                            "source_url", src_url[:120], "p_web_fallback")
        elif "twitter.com" in low_src or "x.com" in low_src:
            ev.add_evidence("twitter_link", src_url, "source_url_social", 0.95,
                            "source_url", src_url[:120], "p_web_fallback")
        elif "linkedin.com" in low_src:
            ev.add_evidence("linkedin_link", src_url, "source_url_social", 0.95,
                            "source_url", src_url[:120], "p_web_fallback")
        elif "instagram.com" in low_src:
            ev.add_evidence("instagram_link", src_url, "source_url_social", 0.95,
                            "source_url", src_url[:120], "p_web_fallback")

    if not results:
        return

    crawled = 0
    for r in results:
        url = safe_str(r.get("url"))
        snip = safe_str(r.get("snippet"))
        source = "duckduckgo_name_lookup"
        low = url.lower()

        if "facebook.com" in low:
            ev.add_evidence("facebook_link", url, source, 0.70, "ddg_result_url", snip or url, "p_web_fallback")
        elif "twitter.com" in low or "x.com" in low:
            ev.add_evidence("twitter_link", url, source, 0.70, "ddg_result_url", snip or url, "p_web_fallback")
        elif "linkedin.com" in low:
            ev.add_evidence("linkedin_link", url, source, 0.70, "ddg_result_url", snip or url, "p_web_fallback")
        elif "instagram.com" in low:
            ev.add_evidence("instagram_link", url, source, 0.70, "ddg_result_url", snip or url, "p_web_fallback")
        elif missing_website and re.search(r"\.(?:gov|org|com|gh)(?:/|$)", low) and not any(
            d in low for d in ["facebook.com", "twitter.com", "x.com", "linkedin.com",
                                "instagram.com", "youtube.com"]
        ):
            domain = _extract_domain_only(url)
            if domain:
                ev.add_evidence("website", domain, source, 0.62, "ddg_result_domain",
                                snip or url, "p_web_fallback")

        txt = f"{safe_str(r.get('title'))} {snip}".lower()
        if re.search(r"\b(volunteer|volunteering|join\s+our\s+team|careers?)\b", txt):
            ev.add_evidence("accepts_volunteers", True, source, 0.55, "ddg_snippet_rule",
                            snip[:120], "p_web_fallback")

        if snip:
            ev.web_snippets.append(snip[:200])

        if crawled < 2 and url and not any(
            d in low for d in ["facebook.com", "twitter.com", "x.com", "linkedin.com",
                                "instagram.com", "youtube.com"]
        ):
            page_text = _fetch_url(url)
            if page_text:
                _extract_facts_expanded(page_text,
                                        f"duckduckgo_name_lookup:{urlparse(url).netloc}",
                                        ev, "p_web_fallback")
                crawled += 1

    ev.sources_used.append("duckduckgo_name_lookup")


def build_shared_evidence(row: Dict[str, Any]) -> SharedEvidence:
    ev = SharedEvidence()
    ev.facility_name = safe_str(row.get("name"))

    ev.procedures_clean = clean_clinical_array(row.get("procedure_parsed"))
    ev.equipment_clean = clean_clinical_array(row.get("equipment_parsed"))
    ev.capabilities_clean = clean_capability_strict(row.get("capability_parsed"))
    ev.valid_specialties = [
        s for s in ensure_list(row.get("specialties_parsed"))
        if s in _FDR_VALID_SPECIALTIES
    ]

    name = safe_str(row.get("name"))
    city = safe_str(row.get("city_clean") or row.get("address_city"))
    has_desc = len(safe_str(row.get("description"))) > cfg.MIN_DESC_LEN

    # Source ladder
    src_url = safe_str(row.get("source_url"))
    if src_url.startswith("http"):
        skip_domains = {"facebook.com", "twitter.com", "linkedin.com", "instagram.com"}
        if not any(d in src_url for d in skip_domains):
            text = _fetch_url(src_url)
            if text:
                _extract_facts_expanded(text, "source_url_official", ev, "p2_web_src_url")
                ev.sources_used.append("source_url")
        else:
            snips = _search_duckduckgo(f'"{name}" hospital clinic Ghana services')
            ev.web_snippets.extend(snips[:2])
            ev.sources_used.append("ddg_social_fallback")

    ev.critical_completeness = ev.compute_critical_completeness(row)

    if not ev.web_facts.get("capacity") or not has_desc:
        text = _fetch_url(f"https://ghanahospitals.org/?s={quote_plus(name)}")
        if text:
            _extract_facts_expanded(text, "ghanahospitals.org", ev, "p2_web_ghanahospitals")
        ev.sources_used.append("ghanahospitals.org")
        ev.critical_completeness = ev.compute_critical_completeness(row)

    if not has_desc and not ev.web_facts.get("description"):
        wiki = _search_wikipedia(f"{name} hospital Ghana")
        if wiki:
            _extract_facts_expanded(wiki, "wikipedia", ev, "p2_web_wikipedia")
            ev.web_snippets.append(wiki[:400])
            ev.sources_used.append("wikipedia")
        ev.critical_completeness = ev.compute_critical_completeness(row)

    needs_more = (
        ev.critical_completeness < cfg.CRITICAL_COMPLETENESS_THRESHOLD
        and (not has_desc or not ev.web_facts.get("capacity") or not ev.web_facts.get("official_phone"))
    )
    if needs_more:
        snips = _search_duckduckgo(
            f'"{name}" hospital clinic Ghana {city} services procedures beds doctors'
        )
        if snips:
            ev.web_snippets.extend(snips)
            for snip in snips:
                _extract_facts_expanded(snip, "duckduckgo", ev, "p2_web_ddg")
            ev.sources_used.append("duckduckgo")
        ev.critical_completeness = ev.compute_critical_completeness(row)

    if not ev.web_facts.get("capacity"):
        text = _fetch_url(f"https://hefra.gov.gh/?s={quote_plus(name)}")
        if text:
            _extract_facts_expanded(text, "hefra.gov.gh", ev, "p2_web_hefra")

    _add_name_based_web_fallback(row, ev)

    ev.web_beds = ev.reconcile("capacity")
    ev.web_doctors = ev.reconcile("number_doctors")
    ev.web_phone = ev.reconcile("official_phone")
    ev.web_email = ev.reconcile("email")
    ev.web_year = ev.reconcile("year_established")
    ev.web_website = ev.reconcile("website")
    desc_prov = ev.best_value("description")
    ev.web_description = desc_prov.value if desc_prov else None

    try:
        ev.commit_reconciled_values(row)
    except Exception:
        pass

    # Build clinical text
    parts = []
    for arr, lbl in [
        (ev.procedures_clean, "Procedure"),
        (ev.equipment_clean, "Equipment"),
        (ev.capabilities_clean, "Capability"),
    ]:
        for item in arr[:8]:
            parts.append(f"{lbl}: {item}")
    if ev.valid_specialties:
        parts.append(f"Specialties: {', '.join(ev.valid_specialties)}")
    desc = safe_str(row.get("description")) or ev.web_description or ""
    if desc and len(desc) > cfg.MIN_DESC_LEN:
        for sent in re.split(r"(?<=[.!?])\s+", desc[:1800]):
            s = sent.strip()
            if len(s) > 15 and not is_junk(s) and (_CLINICAL_HINT_RE.search(s) or len(s) < 80):
                parts.append(f"Description: {s}")
    for snip in ev.web_snippets[:3]:
        s = str(snip).strip()
        if len(s) > 20 and _CLINICAL_HINT_RE.search(s) and not is_junk(s):
            parts.append(f"Web: {s[:150]}")
    for svc in ev.web_services[:3]:
        if not is_junk(svc):
            parts.append(f"Service: {svc}")
    ev.clinical_text = "\n".join(f"- {p}" for p in dedup_list(parts)[:40])

    # Compact context
    ctx = []
    for f_col, lbl in [
        ("name", "name"), ("description", "desc"), ("facility_type_clean", "type"),
        ("facility_tier_label", "tier"), ("facility_complexity_level", "complexity"),
        ("organization_category", "org_cat"), ("ownership_model", "ownership"),
        ("operatorTypeId", "operator"), ("region_normalised", "region"),
        ("city_clean", "city"), ("is_hospital", "is_hospital"),
        ("is_government", "is_govt"), ("is_faith_based", "is_faith"),
        ("is_ngo", "is_ngo"), ("is_teaching_hospital", "is_teaching"),
        ("ghost_probability_score", "ghost_prob"),
        ("clinical_complexity_score", "complexity_score"),
    ]:
        v = row.get(f_col)
        if not is_null_or_empty(v):
            ctx.append(f"{lbl}: {str(v)[:80]}")
    if ev.capabilities_clean:
        ctx.append(f"capabilities: {'; '.join(ev.capabilities_clean[:3])}")
    if ev.valid_specialties:
        ctx.append(f"specialties: {', '.join(ev.valid_specialties[:4])}")
    if ev.web_snippets:
        ctx.append(f"web_snippet: {ev.web_snippets[0][:120]}")
    ev.compact_context = "\n".join(ctx[:22])

    # Web evidence text
    web_parts = []
    if ev.web_description:
        web_parts.append(f"Desc: {ev.web_description[:250]}")
    if ev.web_beds:
        web_parts.append(f"Beds: {ev.web_beds}")
    if ev.web_doctors:
        web_parts.append(f"Doctors: {ev.web_doctors}")
    if ev.web_year:
        web_parts.append(f"Year: {ev.web_year}")
    if ev.web_phone:
        web_parts.append(f"Phone: {ev.web_phone}")
    if ev.web_email:
        web_parts.append(f"Email: {ev.web_email}")
    if ev.web_website:
        web_parts.append(f"Website domain: {ev.web_website}")
    if ev.web_services:
        web_parts.append(f"Services: {'; '.join(ev.web_services[:3])}")
    for snip in ev.web_snippets[:2]:
        web_parts.append(f"Snippet: {str(snip)[:120]}")
    ev.web_evidence_text = "\n".join(web_parts[:10])

    ev.critical_completeness = ev.compute_critical_completeness(row)
    ev.evidence_score = ev.critical_completeness
    return ev

# COMMAND ----------
# MAGIC %md ## 10 — LLM Infrastructure

# COMMAND ----------

def call_llama(
    messages: List[Dict],
    system_prompt: Optional[str] = None,
    max_tokens: int = 3000,
    temperature: float = 0.4,
    retries: int = cfg.LLM_RETRIES,
) -> str:
    full = (
        ([{"role": "system", "content": system_prompt}] if system_prompt else [])
        + messages
    )
    payload = {
        "messages": full,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": 0.9,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {DATABRICKS_TOKEN}",
        "Content-Type": "application/json",
    }
    for attempt in range(retries):
        try:
            resp = requests.post(LLM_ENDPOINT, headers=headers, json=payload, timeout=120)
            if resp.status_code == 429:
                time.sleep(min(2 ** attempt * 10, 60))
                continue
            if resp.status_code == 503:
                time.sleep(2 ** attempt * 3)
                continue
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            if isinstance(content, list):
                content = "".join(
                    p.get("text", "") if isinstance(p, dict) else str(p) for p in content
                )
            elif not isinstance(content, str):
                content = str(content) if content is not None else ""
            time.sleep(cfg.SLEEP_BETWEEN_LLM)
            return content
        except requests.HTTPError as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt * 2)
            else:
                print(f"    [LLM] HTTP {getattr(e.response, 'status_code', '?')} after {retries} retries")
                return ""
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"    [LLM] Error: {e}")
                return ""
    return ""

# COMMAND ----------
# MAGIC %md ## 11 — Phase 1: Org Classification (v11: stricter per PDF definitions)

# COMMAND ----------

def phase1_classify_org(row: Dict[str, Any]) -> str:
    """
    I20: Stricter facility vs NGO classification using PDF definitions.

    FACILITY = physical site CURRENTLY OPERATING delivering IN-PERSON diagnosis/treatment.
    NGO = non-profit delivering TANGIBLE healthcare services in low-resource settings.

    Rule-based first (uses multiple signals), LLM only when genuinely ambiguous.
    """
    org_type = safe_str(row.get("organization_type_clean"))
    if org_type in ("facility", "ngo"):
        return org_type

    name = safe_str(row.get("name", "")).lower()
    name_orig = safe_str(row.get("name", ""))

    # Strong NGO signals from schema
    if row.get("is_ngo") is True:
        return "ngo"
    if safe_str(row.get("missionstatement")) and not safe_str(row.get("facilityTypeId")):
        return "ngo"
    if ensure_list(row.get("countries_parsed")) and not safe_str(row.get("facilityTypeId")):
        return "ngo"
    if safe_str(row.get("organizationdescription")) and not row.get("is_hospital"):
        ngo_words = ["foundation", "relief", "aid", "mission", "charity", "trust",
                     "global", "international", "develop", "ngo"]
        if any(w in name for w in ngo_words):
            return "ngo"

    # Strong FACILITY signals
    if row.get("is_hospital") is True or row.get("is_clinic") is True:
        return "facility"
    if safe_str(row.get("facilityTypeId")):
        return "facility"
    # Physical facility name patterns
    facility_keywords = [
        "hospital", "clinic", "health centre", "health center", "health post",
        "chps", "polyclinic", "pharmacy", "dispensary", "maternity home",
        "eye hospital", "dental", "infirmary", "medical centre", "medical center",
    ]
    if any(kw in name for kw in facility_keywords):
        return "facility"

    # Has physical address + clinical procedures = facility
    has_address = not is_null_or_empty(row.get("address_line1")) or not is_null_or_empty(row.get("address_city"))
    has_clinical = (
        ensure_list(row.get("procedure_parsed")) or
        ensure_list(row.get("equipment_parsed")) or
        ensure_list(row.get("capability_parsed"))
    )
    if has_address and has_clinical:
        return "facility"

    # NGO name patterns
    ngo_keywords = [
        "foundation", "trust", "charity", "ngo", "aid", "relief", "international",
        "global", "world", "care international", "health initiative",
    ]
    if any(kw in name for kw in ngo_keywords):
        return "ngo"

    # LLM disambiguation — only when genuinely unclear
    evidence_parts = []
    for f_col in ["name", "description", "missionstatement", "organizationdescription"]:
        v = safe_str(row.get(f_col))
        if v:
            evidence_parts.append(f"{f_col}: {v[:150]}")
    if not evidence_parts:
        return "facility"  # default: treat as facility if no distinguishing signals

    resp = call_llama(
        messages=[{"role": "user", "content": "\n".join(evidence_parts)}],
        system_prompt=ORGANIZATION_EXTRACTION_SYSTEM_PROMPT,
        max_tokens=150,
        temperature=0.4,
    )
    parsed = parse_json_llm(resp)
    name_lower = name_orig.lower()
    ngos = ensure_list(parsed.get("ngos", []))
    facilities = ensure_list(parsed.get("facilities", []))

    if any(name_lower in n.lower() or n.lower() in name_lower for n in facilities):
        return "facility"
    if any(name_lower in n.lower() or n.lower() in name_lower for n in ngos):
        return "ngo"
    return "facility"

# COMMAND ----------
# MAGIC %md ## 12 — Phase 3: LLM Free-Form Extraction (I13, I21)

# COMMAND ----------

def phase2_extract_freeform(row: Dict[str, Any], ev: SharedEvidence) -> Dict[str, Any]:
    """
    I13: Strict field separation per schema doc definitions.
    I21: Enforce declarative statement style on output.
    """
    if not ev.clinical_text.strip():
        return {
            "procedure": apply_declarative_style(ev.procedures_clean, "procedure"),
            "equipment": apply_declarative_style(ev.equipment_clean, "equipment"),
            "capability": apply_declarative_style(ev.capabilities_clean, "capability"),
            "llm_called": False,
        }

    prompt = FREE_FORM_SYSTEM_PROMPT.format(
        organization=safe_str(row.get("name"), "Unknown Facility"),
        tier=safe_str(row.get("facility_tier_label"), "Standard"),
        complexity=safe_str(row.get("facility_complexity_level"), "L1"),
        ftype=safe_str(row.get("facility_type_clean"), "facility"),
        region=safe_str(row.get("region_normalised"), "Unknown"),
        ghost_prob=safe_str(row.get("ghost_probability_score"), "0.5"),
        operator=safe_str(row.get("operatorTypeId") or row.get("organization_category"), ""),
        content=ev.clinical_text[:3000],
    )
    resp = call_llama(
        messages=[{"role": "user", "content": "Extract clinical facts as JSON. Return ONLY the JSON."}],
        system_prompt=prompt,
        max_tokens=cfg.LLM_MAX_TOKENS_FREEFORM,
        temperature=cfg.LLM_TEMPERATURE_EXTRACT,
    )
    ev.log_step("p3_freeform", "procedure_equipment_capability", resp[:100],
                "llm_freeform", "llm_extraction")

    raw = parse_json_llm(resp)
    try:
        facts = FacilityFacts(**raw)
        # I13: Clean each field with its strict filter
        llm_proc  = clean_clinical_array(facts.procedure or [])
        llm_equip = clean_clinical_array(facts.equipment or [])
        llm_cap   = clean_capability_strict(facts.capability or [])
    except Exception:
        llm_proc, llm_equip, llm_cap = [], [], []

    # I21: Apply declarative style
    final_proc  = apply_declarative_style(dedup_list(ev.procedures_clean + llm_proc), "procedure")
    final_equip = apply_declarative_style(dedup_list(ev.equipment_clean + llm_equip), "equipment")
    final_cap   = apply_declarative_style(dedup_list(ev.capabilities_clean + llm_cap), "capability")

    return {
        "procedure":  final_proc,
        "equipment":  final_equip,
        "capability": final_cap,
        "llm_called": True,
    }

# COMMAND ----------
# MAGIC %md ## 13 — Phase Org Info Fill-in

# COMMAND ----------

def phase3_org_info_fillin(row: Dict[str, Any], ev: SharedEvidence, org_type: str) -> Dict[str, Any]:
    """Web-direct fills first; LLM only for remaining gaps. I16: E164 + domain enforcement."""
    fill: Dict[str, Any] = {}

    # Numeric fills from web evidence
    mappings = [
        ("number_doctors", "number_doctors_int", "numberDoctors", 1, 500, True),
        ("capacity",       "capacity_int",       "capacity",      5, 5000, True),
        ("year_established", "year_established_int", "yearEstablished", 1850, 2026, True),
    ]
    for canonical, df_col, fill_key, lo, hi, is_int in mappings:
        web_val = ev.reconcile(canonical)
        if web_val is not None and is_null_or_empty(row.get(df_col)):
            v = int(web_val) if is_int else web_val
            if lo <= v <= hi:
                fill[fill_key] = v

    # Contact fills — enforce E164 and domain-only
    phone_val = ev.reconcile("official_phone")
    if phone_val and is_null_or_empty(row.get("official_phone")):
        normed = _normalise_phone_e164(str(phone_val))
        if normed:
            fill["officialPhone"] = normed

    email_val = ev.reconcile("email")
    if email_val and is_null_or_empty(row.get("email")):
        fill["email"] = email_val

    web_val = ev.reconcile("website")
    if web_val and is_null_or_empty(row.get("officialWebsite")):
        domain = _extract_domain_only(str(web_val)) or str(web_val).strip()
        if domain:
            fill["officialWebsite"] = domain

    # I17: NGO-specific fields
    if org_type == "ngo":
        mission_val = ev.reconcile("mission_statement")
        if mission_val and is_null_or_empty(row.get("missionstatement")):
            fill["missionStatement"] = str(mission_val)[:400]

    missing_key_fields = any(
        is_null_or_empty(row.get(df_col)) and fill_key not in fill
        for _, df_col, fill_key, *_ in mappings
    )
    evidence_parts = []
    for f_col, lbl in [
        ("description", "Desc"),
        ("missionstatement", "Mission"),
        ("organizationdescription", "OrgDesc"),
    ]:
        v = safe_str(row.get(f_col))
        if v and len(v) > 20:
            evidence_parts.append(f"{lbl}: {v[:250]}")
    for snip in ev.web_snippets[:3]:
        evidence_parts.append(f"Web: {str(snip)[:150]}")
    if ev.web_description:
        evidence_parts.append(f"WebDesc: {ev.web_description[:200]}")

    if not missing_key_fields or not evidence_parts:
        return fill

    facility_name = safe_str(row.get("name"), "Unknown Facility")
    prompt = ORGANIZATION_INFORMATION_SYSTEM_PROMPT.format(organization=facility_name)
    resp = call_llama(
        messages=[{"role": "user", "content": "\n".join(evidence_parts[:8])}],
        system_prompt=prompt,
        max_tokens=cfg.LLM_MAX_TOKENS_ORGINFO,
        temperature=0.4,
    )
    ev.log_step("p_org_info", "org_fields", resp[:100], "llm_org_info", "llm_extraction")

    raw = parse_json_llm(resp)
    try:
        model_cls = NGO if org_type == "ngo" else Facility
        org_data = model_cls(**{**{"name": facility_name}, **raw})
    except Exception:
        return fill

    for src_attr, fill_key, df_col, lo, hi in [
        ("numberDoctors",   "numberDoctors",   "number_doctors_int",  1,   500),
        ("capacity",        "capacity",         "capacity_int",        5,   5000),
        ("yearEstablished", "yearEstablished",  "year_established_int", 1850, 2026),
    ]:
        if fill_key not in fill and is_null_or_empty(row.get(df_col)):
            val = getattr(org_data, src_attr, None)
            if val is not None and isinstance(val, int) and lo <= val <= hi:
                fill[fill_key] = val

    for src_attr, fill_key, df_col in [
        ("email",          "email",          "email"),
        ("officialPhone",  "officialPhone",  "official_phone"),
        ("officialWebsite","officialWebsite","officialWebsite"),
    ]:
        if fill_key not in fill and is_null_or_empty(row.get(df_col)):
            val = getattr(org_data, src_attr, None)
            if val:
                if src_attr == "officialPhone":
                    val = _normalise_phone_e164(str(val))
                elif src_attr == "officialWebsite":
                    val = _extract_domain_only(str(val)) or val
                if val:
                    fill[fill_key] = val

    # I17: NGO fields from model
    if org_type == "ngo" and isinstance(org_data, NGO):
        if is_null_or_empty(row.get("missionstatement")):
            ms = getattr(org_data, "missionStatement", None)
            if ms and "missionStatement" not in fill:
                fill["missionStatement"] = str(ms)[:400]
        if is_null_or_empty(row.get("organizationdescription")):
            od = getattr(org_data, "organizationDescription", None)
            if od and "organizationDescription" not in fill:
                fill["organizationDescription"] = str(od)[:600]

    return fill

# COMMAND ----------
# MAGIC %md ## 14 — Phase 4 (L1): Deterministic Fill

# COMMAND ----------

_GHANA_REGIONS: FrozenSet[str] = frozenset({
    "Greater Accra", "Ashanti", "Western", "Eastern", "Central", "Volta",
    "Northern", "Upper East", "Upper West", "Oti", "Bono East", "Ahafo",
    "Savannah", "North East", "Western North", "Brong-Ahafo",
})


def phase4_l1_deterministic(row: Dict[str, Any]) -> Dict[str, Any]:
    fills: Dict[str, Any] = {}

    def _set(df_col: str, v: Any):
        if is_null_or_empty(row.get(df_col)) and v is not None:
            fills[df_col] = v

    _set("address_country", "Ghana")
    _set("address_countryCode", "GH")

    region = safe_str(row.get("region_normalised"))
    if region and region != "Unknown" and region in _GHANA_REGIONS:
        _set("address_stateOrRegion", region)

    if is_null_or_empty(row.get("operatorTypeId")):
        is_pub = row.get("is_public") is True or row.get("is_government") is True
        org_cat = safe_str(row.get("organization_category"))
        own_mdl = safe_str(row.get("ownership_model"))
        if is_pub or org_cat in ("government",) or own_mdl in ("government", "academic_government", "military"):
            _set("operatorTypeId", "public")
        elif row.get("is_private") is True or org_cat in ("private"):
            _set("operatorTypeId", "private")
        elif row.get("is_ngo") is True:
            _set("operatorTypeId", "private")

    if is_null_or_empty(row.get("affiliationtypeids")):
        tags = []
        if row.get("is_faith_based") is True:
            tags.append("faith-tradition")
        if row.get("is_government") is True or safe_str(row.get("organization_category")) == "government":
            tags.append("government")
        if row.get("is_ngo") is True:
            tags.append("philanthropy-legacy")
        if row.get("is_teaching_hospital") is True:
            tags.append("academic")
        if tags:
            _set("affiliationtypeids", json.dumps(tags))

    if is_null_or_empty(row.get("affiliationtypeids")):
        name = safe_str(row.get("name", ""))
        for pattern, tags in FAITH_NAME_PATTERNS:
            if pattern.search(name):
                _set("affiliationtypeids", json.dumps(tags))
                _set("is_faith_based", True)
                break

    # I17: acceptsVolunteers deterministic logic
    if is_null_or_empty(row.get("accepts_volunteers_bool")):
        is_ngo = row.get("is_ngo") is True
        accept_raw = safe_str(row.get("acceptsvolunteers", "")).lower()
        if accept_raw in ("true", "yes", "1"):
            _set("accepts_volunteers_bool", True)
        elif accept_raw in ("false", "no", "0"):
            _set("accepts_volunteers_bool", False)
        elif is_ngo:
            # NGOs default to accepting volunteers unless stated otherwise
            _set("accepts_volunteers_bool", True)

    _set("capacity_confidence",
         "web_extracted" if not is_null_or_empty(row.get("capacity_int")) else "not_extracted")
    _set("doctors_confidence",
         "web_extracted" if not is_null_or_empty(row.get("number_doctors_int")) else "not_extracted")
    _set("year_confidence",
         "web_extracted" if not is_null_or_empty(row.get("year_established_int")) else "not_extracted")

    if is_null_or_empty(row.get("region_source")):
        _set("region_source", "state_field" if region and region != "Unknown" else "unknown")

    if is_null_or_empty(row.get("geo_precision_tier")):
        geo_src = safe_str(row.get("geo_source"))
        tier_map = {
            "geopy_nominatim": 5, "text_extracted_city": 4,
            "static_city_dict": 3, "extended_city_dict": 3,
            "district_centroid": 3, "region_centroid": 2, "country_centroid": 1,
        }
        _set("geo_precision_tier", tier_map.get(geo_src, 0))

    if is_null_or_empty(row.get("address_type")):
        addr = safe_str(row.get("address_line1") or row.get("postal_address"))
        if re.search(r"(?i)(p\.?\s*o\.?\s*box|pmb|private\s+mail)", addr):
            _set("address_type", "postal")
        elif addr and len(addr) > 3:
            _set("address_type", "physical")

    if is_null_or_empty(row.get("facility_type_clean")):
        if row.get("is_hospital") is True:
            _set("facility_type_clean", "hospital")
        elif row.get("is_clinic") is True:
            _set("facility_type_clean", "clinic")

    if is_null_or_empty(row.get("organization_type_clean")):
        _set("organization_type_clean", "ngo" if row.get("is_ngo") is True else "facility")

    if is_null_or_empty(row.get("ngo_serves_ghana")) and row.get("is_ngo") is True:
        lat = safe_float(row.get("latitude"))
        lon = safe_float(row.get("longitude"))
        in_ghana = (
            lat is not None and 4.0 <= lat <= 12.0
            and lon is not None and -4.0 <= lon <= 2.0
        )
        _set("ngo_serves_ghana",
             bool(in_ghana or safe_str(row.get("address_country", "")).lower() == "ghana"))

    if is_null_or_empty(row.get("geo_contradiction_flag")):
        _set("geo_contradiction_flag",
             bool(
                 safe_str(row.get("geo_source")) == "country_centroid"
                 and safe_float(row.get("data_completeness_score"), 0) >= 0.5
                 and row.get("has_contact") is True
             ))

    return fills

# COMMAND ----------
# MAGIC %md ## 15 — Phase 5 (L2): Semantic / Ontology Fill

# COMMAND ----------

def phase5_l2_semantic(
    row: Dict[str, Any],
    extracted: Dict[str, Any],
    ev: SharedEvidence,
) -> Dict[str, Any]:
    fills: Dict[str, Any] = {}

    def _set(df_col: str, v: Any):
        if is_null_or_empty(row.get(df_col)) and v is not None:
            fills[df_col] = v

    all_procedures = extracted.get("procedure", []) + ev.procedures_clean
    all_capabilities = extracted.get("capability", []) + ev.capabilities_clean
    name = safe_str(row.get("name", ""))

    # I18: Conservative specialty inference from explicit procedures only
    inferred_specialties: List[str] = list(ev.valid_specialties)
    combined_text = " ".join(all_procedures + all_capabilities)
    for pattern, specs in PROCEDURE_TO_SPECIALTIES.items():
        if re.search(pattern, combined_text):
            for s in specs:
                if s in _FDR_VALID_SPECIALTIES and s not in inferred_specialties:
                    inferred_specialties.append(s)
    for pattern, specs in CAPABILITY_TO_SPECIALTIES.items():
        if re.search(pattern, combined_text):
            for s in specs:
                if s in _FDR_VALID_SPECIALTIES and s not in inferred_specialties:
                    inferred_specialties.append(s)

    # Name-based tier and specialty hints
    tier_from_name: Optional[str] = None
    for name_re, tier_label, tier_specs in NAME_TO_TIER:
        if name_re.search(name):
            tier_from_name = tier_label
            for s in tier_specs:
                if s in _FDR_VALID_SPECIALTIES and s not in inferred_specialties:
                    inferred_specialties.append(s)
            break

    if tier_from_name:
        _set("facility_tier_label", tier_from_name)

    # Archetype-based fills
    archetype = get_archetype(row)
    if archetype:
        if is_null_or_empty(row.get("capacity_int")):
            bed_est = (archetype.bed_range[0] + archetype.bed_range[1]) // 2
            fills["capacity_int"] = bed_est
            fills["capacity_confidence"] = "archetype_estimate"
        if is_null_or_empty(row.get("number_doctors_int")):
            doc_est = (archetype.doctor_range[0] + archetype.doctor_range[1]) // 2
            fills["number_doctors_int"] = doc_est
            fills["doctors_confidence"] = "archetype_estimate"
        if is_null_or_empty(row.get("operatorTypeId")):
            fills["operatorTypeId"] = archetype.typical_operator
        if is_null_or_empty(row.get("facility_complexity_level")):
            fills["facility_complexity_level"] = archetype.complexity
        # I18: Only add archetype specialties if they have supporting evidence
        if combined_text or ev.valid_specialties:
            for s in archetype.expected_specialties:
                if s in _FDR_VALID_SPECIALTIES and s not in inferred_specialties:
                    inferred_specialties.append(s)

    # Capability-flag specialties
    flag_map = [
        ("has_icu", "criticalCareMedicine"),
        ("has_surgery", "generalSurgery"),
        ("has_obstetrics", "gynecologyAndObstetrics"),
        ("has_pediatrics", "pediatrics"),
        ("has_radiology", "radiology"),
        ("has_emergency_medicine", "emergencyMedicine"),
        ("has_mental_health", "psychiatry"),
    ]
    for flag, spec in flag_map:
        if row.get(flag) is True and spec not in inferred_specialties:
            inferred_specialties.append(spec)

    if is_null_or_empty(row.get("facility_complexity_level")):
        tier = safe_str(row.get("facility_tier_label") or tier_from_name, "")
        comp_map = {
            "academic": "L4", "teaching": "L4",
            "regional": "L3", "referral": "L3", "military": "L3", "specialist": "L3",
            "district": "L2", "polyclinic": "L2", "mission": "L2",
            "primary": "L1", "chps": "L1", "clinic": "L1",
        }
        for kw, comp in comp_map.items():
            if kw in tier.lower() or kw in name.lower():
                _set("facility_complexity_level", comp)
                break

    fills["_kg_specialties"] = inferred_specialties
    return fills

# COMMAND ----------
# MAGIC %md ## 16 — Phase 6 (L3): Web Evidence Apply

# COMMAND ----------

def phase6_l3_web_apply(row: Dict[str, Any], ev: SharedEvidence) -> Dict[str, Any]:
    """Apply web evidence with trust-tier-aware override. I16: E164 + domain enforcement."""
    fills: Dict[str, Any] = {}

    def _apply(df_col: str, canonical: str, confidence_col: Optional[str] = None,
               lo=None, hi=None, is_int: bool = False):
        if not is_null_or_empty(row.get(df_col)):
            return
        val = ev.reconcile(canonical)
        if val is None:
            return
        if lo is not None and hi is not None:
            try:
                v = int(val) if is_int else float(val)
            except (TypeError, ValueError):
                return
            if not (lo <= v <= hi):
                return
            val = v
        fills[df_col] = val
        if confidence_col:
            fills[confidence_col] = "web_extracted"

    _apply("capacity_int",         "capacity",        "capacity_confidence", 5, 5000, True)
    _apply("number_doctors_int",   "number_doctors",  "doctors_confidence",  1, 500,  True)
    _apply("year_established_int", "year_established","year_confidence",     1850, 2026, True)
    _apply("email",                "email")
    _apply("address_line1",        "address_line1")
    _apply("address_line2",        "address_line2")
    _apply("address_line3",        "address_line3")
    _apply("address_city",         "address_city")
    _apply("address_stateOrRegion","address_region")
    _apply("address_zipOrPostcode","address_zipOrPostcode")
    _apply("organizationdescription", "org_description")
    _apply("area_int",             "area", "area_confidence", 1, 1000000, True)
    _apply("facebooklink",         "facebook_link")
    _apply("twitterlink",          "twitter_link")
    _apply("linkedinlink",         "linkedin_link")
    _apply("instagramlink",        "instagram_link")
    _apply("logo",                 "logo")
    _apply("missionstatement",     "mission_statement")

    # I16: Phone — enforce E164
    if is_null_or_empty(row.get("official_phone")):
        phone_val = ev.reconcile("official_phone")
        if phone_val:
            normed = _normalise_phone_e164(str(phone_val))
            if normed:
                fills["official_phone"] = normed
                fills["phone_confidence"] = "web_extracted"

    # I16: Website — domain only
    if is_null_or_empty(row.get("officialWebsite")):
        web_val = ev.reconcile("website")
        if web_val:
            domain = _extract_domain_only(str(web_val))
            if domain:
                fills["officialWebsite"] = domain

    # I17: acceptsVolunteers
    if is_null_or_empty(row.get("accepts_volunteers_bool")):
        v = ev.reconcile("accepts_volunteers")
        if isinstance(v, bool):
            fills["accepts_volunteers_bool"] = v
        elif v is not None:
            s = str(v).strip().lower()
            if s in ("true", "1", "yes"):
                fills["accepts_volunteers_bool"] = True
            elif s in ("false", "0", "no"):
                fills["accepts_volunteers_bool"] = False

    if is_null_or_empty(row.get("acceptsvolunteers")) and "accepts_volunteers_bool" in fills:
        fills["acceptsvolunteers"] = fills["accepts_volunteers_bool"]

    if is_null_or_empty(row.get("description")) and ev.web_description:
        fills["description"] = ev.web_description

    return fills

# COMMAND ----------
# MAGIC %md ## 17 — Phase 7 (L4): Batched LLM Fill

# COMMAND ----------

def _cast_filled_value(canonical: str, raw_val: str) -> Optional[Any]:
    if not raw_val or str(raw_val).strip() in ("null", "None", "nan", "N/A", "__UNKNOWN__"):
        return None
    raw_str = str(raw_val).strip()

    spec = FIELD_REGISTRY.get(canonical)
    dtype = spec.dtype if spec else "string"

    if dtype == "integer":
        m = re.search(r"\d{1,5}", raw_str)
        if not m:
            return None
        v = int(m.group())
        if spec and spec.validation:
            lo, hi = spec.validation
            if not (lo <= v <= hi):
                return None
        return v

    if dtype == "boolean":
        s = raw_str.lower()
        if s in ("true", "yes", "1"):
            return True
        if s in ("false", "no", "0"):
            return False
        return None

    if dtype == "array":
        try:
            p = json.loads(raw_str)
            if isinstance(p, list):
                return json.dumps([str(x) for x in p if x])
        except Exception:
            pass
        for sep in [";", ","]:
            parts = [x.strip().strip('"').strip("'") for x in raw_str.split(sep) if x.strip()]
            if parts:
                return json.dumps(parts)
        return None

    # String fields
    if canonical == "email":
        m = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", raw_str)
        if m:
            return m.group(0)
        return None

    if canonical == "official_phone":
        # I16: strict E164
        return _normalise_phone_e164(raw_str)

    if canonical == "website":
        # I16: domain only
        domain = _extract_domain_only(raw_str)
        return domain

    if canonical == "facebook_link":
        s = raw_str.strip()
        if "facebook.com" in s:
            return s[:300]
        return None

    return raw_str if len(raw_str) >= 2 else None


def _consolidate_descriptions(row: Dict[str, Any], ev: SharedEvidence) -> Dict[str, Any]:
    """I23: Consolidate description from multiple sources into concise factual paragraph."""
    result: Dict[str, Any] = {}
    input_desc = safe_str(row.get("description", ""))
    input_org_desc = safe_str(row.get("organizationdescription", ""))
    web_desc = ev.web_description or ""
    web_snippets_text = " ".join(ev.web_snippets[:3]) if ev.web_snippets else ""

    sources = [s for s in [input_desc, web_desc] if s and len(s) > 20]

    if len(sources) >= 2:
        consolidated_prompt = f"""You are a medical data editor for healthcare facilities in Ghana.
Your task: produce TWO concise factual descriptions for: {safe_str(row.get('name'), 'Unknown')}

SOURCE A (Database): {input_desc[:400] if input_desc else '(none)'}
SOURCE B (Web): {web_desc[:400] if web_desc else '(none)'}
SOURCE C (Web Snippets): {web_snippets_text[:300] if web_snippets_text else '(none)'}

RULES:
- description: 60-200 characters. Focus on facility type, key medical services, care level.
  Do NOT include: phone numbers, addresses, business hours, social media, accreditation numbers.
  Good: "District hospital providing emergency care, surgery, maternity services and outpatient clinics."
- organizationdescription: 100-400 characters. Neutral factual overview: mission, history, community served.
  No explicitly religious/subjective language. No contact info.

Return ONLY valid JSON (no markdown):
{{"description": "...", "organizationdescription": "..."}}"""

        resp = call_llama(
            messages=[{"role": "user", "content": consolidated_prompt}],
            max_tokens=1000,
            temperature=0.1,
        )
        parsed = parse_json_llm(resp)
        consolidated_desc = safe_str(parsed.get("description", ""))
        consolidated_org_desc = safe_str(parsed.get("organizationdescription", ""))
        if len(consolidated_desc) >= 30:
            result["description"] = consolidated_desc
        if len(consolidated_org_desc) >= 40:
            result["organizationdescription"] = consolidated_org_desc
    else:
        # Single source
        best = web_desc if len(web_desc) > len(input_desc) else input_desc
        if len(best) >= 30 and is_null_or_empty(row.get("description")):
            result["description"] = best[:400]
        if input_org_desc and len(input_org_desc) >= 30 and is_null_or_empty(row.get("organizationdescription")):
            result["organizationdescription"] = input_org_desc[:500]

    # Normalize postal_address
    postal_addr = safe_str(row.get("postal_address", ""))
    if postal_addr:
        po_match = re.search(r'(P\.?\s*O\.?\s*(?:Box|BOX)?\s+[A-Z0-9\.\-]+|PMB\s+\w+)',
                             postal_addr, re.IGNORECASE)
        if po_match:
            result["postal_address"] = po_match.group(0).strip()

    return result


def phase7_l4_batched_llm(row: Dict[str, Any], ev: SharedEvidence) -> Dict[str, Any]:
    """ONE batched LLM call for all remaining critical fields. I16: E164 + domain enforcement."""
    missing: List[Tuple[str, str, str, str, int]] = []
    for canonical, (desc, typ, fmt, priority) in sorted(
        cfg.BATCH_FILL_SPECS.items(), key=lambda kv: kv[1][3]
    ):
        spec = FIELD_REGISTRY.get(canonical)
        df_col = spec.df_col if spec else canonical
        if is_null_or_empty(row.get(df_col)):
            missing.append((canonical, df_col, desc, fmt, priority))

    if not any(p <= 2 for *_, p in missing):
        return {}

    fields_spec = "\n".join(
        f'  "{can}": ({cfg.BATCH_FILL_SPECS[can][1]}) {desc}. Format: {fmt}'
        for can, _, desc, fmt, _ in missing[:12]
    )

    archetype = get_archetype(row)
    arch_hint = ""
    if archetype:
        arch_hint = (
            f"Archetype: {archetype.name}. "
            f"Typical beds: {archetype.bed_range[0]}-{archetype.bed_range[1]}. "
            f"Typical doctors: {archetype.doctor_range[0]}-{archetype.doctor_range[1]}."
        )

    prompt = BATCHED_NULL_FILL_PROMPT.format(
        name=safe_str(row.get("name"), "Unknown"),
        city=safe_str(row.get("city_clean") or row.get("address_city"), ""),
        region=safe_str(row.get("region_normalised"), ""),
        ftype=safe_str(row.get("facility_type_clean"), "facility"),
        operator=safe_str(row.get("operatorTypeId") or row.get("organization_category"), ""),
        tier=safe_str(row.get("facility_tier_label"), "Standard"),
        complexity=safe_str(row.get("facility_complexity_level"), "L1"),
        ghost_prob=safe_str(row.get("ghost_probability_score"), "0.5"),
        context=(ev.compact_context + ("\n" + arch_hint if arch_hint else ""))[:700],
        web_evidence=ev.web_evidence_text[:400],
        fields_spec=fields_spec,
    )

    resp = call_llama(
        messages=[{"role": "user", "content": f"Fill missing fields for '{safe_str(row.get('name'))}'. Return ONLY JSON."}],
        system_prompt=prompt,
        max_tokens=cfg.LLM_MAX_TOKENS_NULL_FILL,
        temperature=cfg.LLM_TEMPERATURE_NULL_FILL,
    )
    ev.log_step("p7_batched_llm", "multi_field", resp[:100], "llm_batched", "batched_null_fill")

    raw_parsed = parse_json_llm(resp)
    if not raw_parsed:
        return {}

    filled: Dict[str, Any] = {}
    for canonical, df_col, *_ in missing:
        raw_val = raw_parsed.get(canonical)
        if raw_val is None:
            continue
        cast_val = _cast_filled_value(canonical, str(raw_val))
        if cast_val is not None:
            filled[df_col] = cast_val

    return filled

# COMMAND ----------
# MAGIC %md ## 18 — Phase 8: Capability Validation

# COMMAND ----------

def phase8_validate_capability(row: Dict[str, Any], extracted: Dict[str, Any]) -> Dict[str, Any]:
    caps  = extracted.get("capability", [])
    procs = extracted.get("procedure", [])
    equip = extracted.get("equipment", [])

    if not caps:
        return {"is_valid": True, "anomalies": [], "confidence_score": 1.0}

    _VALID_CAP_RE = re.compile(
        r"(?i)(icu|intensive\s+care|nicu|emergency|trauma|level\s+[ivx\d]+|"
        r"operating\s+theatre|surgical|maternity|antenatal|inpatient|outpatient|"
        r"dialysis|chemotherapy|radiotherapy|blood\s+bank|mortuary|laboratory|"
        r"24.hour|beds?\b|ward|unit|program|accredited|certified|pmtct|hiv|tb|malaria)"
    )
    if not any(_VALID_CAP_RE.search(c) for c in caps):
        return {"is_valid": True, "anomalies": [], "confidence_score": 0.65}

    def fmt(arr):
        return "\n".join(f"  * {x}" for x in arr[:6]) if arr else "  (none)"

    ghost_prob = safe_float(row.get("ghost_probability_score"), 0.5)
    prompt = CAPABILITY_VALIDATION_PROMPT.format(
        facility_name=safe_str(row.get("name"), "Unknown"),
        facility_type=safe_str(row.get("facility_type_clean"), "unknown"),
        tier=safe_str(row.get("facility_tier_label"), "Standard"),
        complexity=safe_str(row.get("facility_complexity_level"), "L1"),
        region=safe_str(row.get("region_normalised"), "Unknown"),
        doctor_count=(str(int(row["number_doctors_int"])) if row.get("number_doctors_int") is not None else "NULL"),
        bed_capacity=(str(int(row["capacity_int"])) if row.get("capacity_int") is not None else "NULL"),
        ghost_prob=f"{ghost_prob:.2f}",
        capabilities=fmt(caps),
        procedures=fmt(procs),
        equipment=fmt(equip),
    )
    resp = call_llama(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=cfg.LLM_MAX_TOKENS_VALIDATE,
        temperature=cfg.LLM_TEMPERATURE_VALIDATE,
    )
    result = parse_json_llm(resp)
    is_valid = bool(result.get("is_valid", True))
    anomalies = clean_clinical_array(result.get("anomalies", []))
    confidence = float(result.get("confidence_score", 0.75 if is_valid else 0.35))
    confidence = max(0.0, min(1.0, confidence))
    if ghost_prob > 0.7 and confidence > 0.6:
        confidence = round(confidence * 0.9, 3)
    return {"is_valid": is_valid, "anomalies": anomalies, "confidence_score": confidence}

# COMMAND ----------
# MAGIC %md ## 19 — Phase 9: Specialty Inference (I18: Conservative)

# COMMAND ----------

def phase9_infer_specialties(
    row: Dict[str, Any],
    extracted: Dict[str, Any],
    ev: SharedEvidence,
    kg_specialties: List[str],
) -> List[str]:
    """
    I18: Conservative specialty extraction.
    Only predict specialties clearly mentioned or strongly implied.
    No inference from generic terms like "comprehensive care" or "full service".
    """
    existing = list(dict.fromkeys(ev.valid_specialties + kg_specialties))
    existing = [s for s in existing if s in _FDR_VALID_SPECIALTIES]

    procs  = extracted.get("procedure", [])
    equips = extracted.get("equipment", [])
    caps   = extracted.get("capability", [])

    # I18: Only call LLM if we have actual clinical evidence (not just names)
    has_clinical_evidence = bool(procs or equips or caps)
    if len(existing) >= 3 and not has_clinical_evidence:
        return existing[:8]

    # If no clinical evidence at all and no existing, don't fabricate specialties
    if not has_clinical_evidence and not existing:
        return []

    evidence_parts = []
    for items, label in [
        (procs[:5],  "Procedure"),
        (equips[:4], "Equipment"),
        (caps[:4],   "Capability"),
    ]:
        for item in items:
            evidence_parts.append(f"{label}: {item}")
    desc = safe_str(row.get("description"))
    if desc and len(desc) > 20:
        evidence_parts.append(f"Description: {desc[:250]}")

    if not evidence_parts and not existing:
        return []

    # I18: Max counts by facility tier
    tier = safe_str(row.get("facility_tier_label", "")).lower()
    max_specs = 12 if "teaching" in tier else (9 if "regional" in tier else 6)

    prompt = MEDICAL_SPECIALTIES_SYSTEM_PROMPT.format(
        organization=safe_str(row.get("name"), "Unknown"),
        facility_type=safe_str(row.get("facility_type_clean"), "facility"),
        tier=safe_str(row.get("facility_tier_label"), "Standard"),
        region=safe_str(row.get("region_normalised"), "Unknown"),
        complexity=safe_str(row.get("facility_complexity_level"), "L1"),
        existing_specs=", ".join(existing) or "(none)",
        evidence="\n".join(evidence_parts[:20]) or "(no clinical evidence)",
    )
    resp = call_llama(
        messages=[{
            "role": "user",
            "content": "\n".join(evidence_parts[:15]) or safe_str(row.get("name", "")),
        }],
        system_prompt=prompt,
        max_tokens=cfg.LLM_MAX_TOKENS_SPECIALTY,
        temperature=0.2,
    )
    ev.log_step("p9_specialty", "specialties", resp[:100], "llm_specialty", "specialty_inference")

    raw = parse_json_llm(resp)
    try:
        spec_model = MedicalSpecialties(**raw)
        inferred = [s for s in (spec_model.specialties or []) if s in _FDR_VALID_SPECIALTIES]
    except Exception:
        inferred = []

    result = list(dict.fromkeys(existing + inferred))[:max_specs]
    return result

# COMMAND ----------
# MAGIC %md ## 20 — Phase 10: Medical Gap Intelligence (I22)

# COMMAND ----------

def phase10_medical_gap_intelligence(
    row: Dict[str, Any],
    extracted: Dict[str, Any],
    final_specs: List[str],
) -> Dict[str, Any]:
    """
    I22: Enhanced medical gap intelligence.
    Identifies infrastructure gaps, medical deserts, service availability.
    These signals directly support the PDF goal of identifying where care exists
    and where it is missing.
    """
    caps  = extracted.get("capability", [])
    procs = extracted.get("procedure", [])
    equip = extracted.get("equipment", [])
    all_text = " ".join(caps + procs + equip).lower()

    def has_keyword(*kws) -> bool:
        return any(kw in all_text for kw in kws)

    ftype = safe_str(row.get("facility_type_clean", "")).lower()
    tier = safe_str(row.get("facility_tier_label", "")).lower()
    name_lower = safe_str(row.get("name", "")).lower()
    is_hospital = row.get("is_hospital") is True
    is_teaching = row.get("is_teaching_hospital") is True
    is_referral = row.get("is_referral_center") is True
    region = safe_str(row.get("region_normalised", "Unknown"))

    gap_flags: List[str] = []

    if is_hospital:
        if not row.get("has_icu") and not has_keyword("icu", "intensive care", "critical care"):
            gap_flags.append("NO_ICU")
        if not row.get("has_emergency_medicine") and not has_keyword(
            "emergency", "trauma", "casualty", "a&e", "accident"
        ):
            gap_flags.append("NO_EMERGENCY_CARE")
        if not row.get("has_obstetrics") and not has_keyword(
            "maternity", "obstetric", "delivery", "labour", "antenatal"
        ):
            gap_flags.append("NO_MATERNITY")
        if "generalSurgery" not in final_specs and not has_keyword(
            "surgery", "surgical", "operating theatre", "operation"
        ):
            gap_flags.append("NO_SURGERY")
        if is_null_or_empty(row.get("number_doctors_int")):
            gap_flags.append("MISSING_DOCTOR_COUNT")
        if is_null_or_empty(row.get("capacity_int")):
            gap_flags.append("MISSING_BED_CAPACITY")
        if not has_keyword("blood bank", "transfusion", "blood storage"):
            gap_flags.append("NO_BLOOD_BANK")

    if is_teaching:
        if not has_keyword("radiology", "x-ray", "imaging", "mri", "ct scan", "ultrasound"):
            gap_flags.append("TEACHING_HOSPITAL_MISSING_IMAGING")
        if "pathology" not in final_specs and "clinicalPathology" not in final_specs:
            gap_flags.append("TEACHING_HOSPITAL_MISSING_PATHOLOGY")
        if not has_keyword("icu", "intensive care"):
            gap_flags.append("TEACHING_HOSPITAL_MISSING_ICU")

    if is_referral:
        if not has_keyword("blood bank", "transfusion"):
            gap_flags.append("REFERRAL_CENTER_MISSING_BLOOD_BANK")
        if not has_keyword("radiology", "x-ray", "ct scan", "mri"):
            gap_flags.append("REFERRAL_CENTER_MISSING_IMAGING")

    # Service coverage score
    essential_services = [
        ("emergency_care", r"(?i)(emergency|trauma|a&e|casualty)"),
        ("maternity",      r"(?i)(maternity|obstetric|labour|delivery)"),
        ("pediatrics",     r"(?i)(pediatric|paediatric|child\s+health|neonatal)"),
        ("surgery",        r"(?i)(surgery|surgical|operating\s+theatre)"),
        ("lab_services",   r"(?i)(laboratory|blood\s+test|cbc|urinalysis|pathology)"),
        ("pharmacy",       r"(?i)(pharmacy|dispensary|drug)"),
        ("hiv_care",       r"(?i)(hiv|art|antiretroviral|pmtct)"),
        ("malaria_care",   r"(?i)(malaria|artemisinin|rdt|rapid\s+diagnostic)"),
        ("radiology",      r"(?i)(x.?ray|ultrasound|ct\s+scan|mri|imaging)"),
        ("mental_health",  r"(?i)(mental\s+health|psychiatric|psychology|counseling)"),
    ]
    present_services = sum(1 for _, pat in essential_services if re.search(pat, all_text))
    service_coverage_score = round(present_services / len(essential_services), 3)

    # I22: Medical desert classification
    lat = safe_float(row.get("latitude"))
    lon = safe_float(row.get("longitude"))
    region_upper = region.upper()
    # Regions known for sparse coverage in Ghana
    desert_regions = {"UPPER EAST", "UPPER WEST", "NORTH EAST", "SAVANNAH", "OTI", "AHAFO"}
    is_likely_desert_region = any(dr in region_upper for dr in desert_regions)
    medical_desert_score = safe_float(row.get("medical_desert_score"), 0.0)

    desert_flags: List[str] = []
    if is_likely_desert_region and service_coverage_score < 0.3:
        desert_flags.append("PROBABLE_MEDICAL_DESERT")
    if service_coverage_score < 0.2 and is_hospital:
        desert_flags.append("CRITICAL_SERVICE_GAPS")
    if len(gap_flags) >= 4:
        desert_flags.append("MULTI_DOMAIN_GAPS")

    # Plausibility checks
    plausibility_flags: List[str] = []
    if "chps" in name_lower or ftype == "clinic":
        if has_keyword("icu", "intensive care", "open heart", "bypass graft"):
            plausibility_flags.append("IMPLAUSIBLE_ICU_IN_PRIMARY_CARE")
        if has_keyword("dialysis", "hemodialysis"):
            plausibility_flags.append("IMPLAUSIBLE_DIALYSIS_IN_CHPS")
        if has_keyword("chemotherapy", "radiation therapy"):
            plausibility_flags.append("IMPLAUSIBLE_ONCOLOGY_IN_CHPS")

    nd = safe_float(row.get("number_doctors_int"))
    cap = safe_float(row.get("capacity_int"))
    if nd is not None and cap is not None and nd > 0 and cap > 0:
        bed_to_doc_ratio = cap / nd
        if bed_to_doc_ratio > 50:
            plausibility_flags.append(f"HIGH_BED_DOCTOR_RATIO:{bed_to_doc_ratio:.0f}")

    # Ghost risk
    ghost_prob = safe_float(row.get("ghost_probability_score"), 0.5)
    ghost_flags: List[str] = []
    if ghost_prob > 0.7:
        ghost_flags.append("HIGH_GHOST_RISK")
    ev_available = bool(procs) or bool(caps) or bool(final_specs)
    if not ev_available:
        ghost_flags.append("NO_CLINICAL_EVIDENCE")
    if is_null_or_empty(row.get("official_phone")) and is_null_or_empty(row.get("email")):
        ghost_flags.append("NO_CONTACT_INFO")
    if is_null_or_empty(row.get("officialWebsite")) and is_null_or_empty(row.get("source_url")):
        ghost_flags.append("NO_DIGITAL_PRESENCE")

    # I22: NGO overlap analysis (for planning/coordination)
    is_ngo = row.get("is_ngo") is True
    ngo_overlap_flags: List[str] = []
    if is_ngo:
        if has_keyword("outreach", "camp", "mission", "temporary", "visiting"):
            ngo_overlap_flags.append("NGO_LIKELY_OUTREACH_ONLY")
        if has_keyword("permanent", "standing", "resident", "full-time"):
            ngo_overlap_flags.append("NGO_PERMANENT_PRESENCE")

    return {
        "gap_flags":              gap_flags,
        "plausibility_flags":     plausibility_flags,
        "ghost_flags":            ghost_flags,
        "desert_flags":           desert_flags,
        "ngo_overlap_flags":      ngo_overlap_flags,
        "service_coverage_score": service_coverage_score,
        "gap_count":              len(gap_flags),
        "has_critical_gaps":      any(g in gap_flags for g in [
            "NO_EMERGENCY_CARE", "NO_SURGERY", "MISSING_DOCTOR_COUNT",
            "CRITICAL_SERVICE_GAPS"
        ]),
        "is_probable_medical_desert": "PROBABLE_MEDICAL_DESERT" in desert_flags,
        "services_present":       present_services,
        "services_total":         len(essential_services),
    }

# COMMAND ----------
# MAGIC %md ## 21 — Phase 11: NGO Field Population (I17)

# COMMAND ----------

def phase11_ngo_field_population(row: Dict[str, Any], ev: SharedEvidence, org_type: str) -> Dict[str, Any]:
    """
    I17: Explicit handling of NGO-specific fields from schema doc:
    - countries (list[str]): ISO alpha-2 codes where NGO operates
    - missionStatement (str): formal mission statement
    - missionStatementLink (str): URL to published mission statement
    - organizationDescription (str): neutral factual description, no religious/subjective language
    - acceptsVolunteers (bool): whether org accepts clinical volunteers
    """
    if org_type != "ngo":
        return {}

    fills: Dict[str, Any] = {}

    # Countries: try to extract from existing data
    if is_null_or_empty(row.get("countries")):
        country_code = safe_str(row.get("address_countryCode", ""))
        existing_countries = ensure_list(row.get("countries_parsed"))
        if not existing_countries and country_code:
            existing_countries = [country_code]
        elif not existing_countries and not is_null_or_empty(row.get("address_country")):
            existing_countries = ["GH"]  # Ghana default for this dataset
        if existing_countries:
            fills["countries"] = json.dumps(existing_countries)

    # Mission statement from web evidence
    mission_val = ev.reconcile("mission_statement")
    if mission_val and is_null_or_empty(row.get("missionstatement")):
        fills["missionstatement"] = str(mission_val)[:400]

    # Organization description — neutral, no religious language
    if is_null_or_empty(row.get("organizationdescription")):
        org_desc_val = ev.reconcile("org_description")
        if org_desc_val:
            # Strip explicitly religious language per schema doc
            cleaned = re.sub(
                r"(?i)(in\s+the\s+name\s+of\s+god|god.s\s+love|christ.s\s+mission|"
                r"by\s+the\s+grace\s+of\s+god|praise\s+the\s+lord|hallelujah|"
                r"god\s+bless|blessed\s+by|through\s+prayer)",
                "", str(org_desc_val)
            )
            cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
            if len(cleaned) >= 30:
                fills["organizationdescription"] = cleaned[:600]

    # acceptsVolunteers — NGOs default to accepting volunteers
    if is_null_or_empty(row.get("accepts_volunteers_bool")):
        volunteer_val = ev.reconcile("accepts_volunteers")
        if isinstance(volunteer_val, bool):
            fills["accepts_volunteers_bool"] = volunteer_val
        else:
            fills["accepts_volunteers_bool"] = True  # NGO default

    if "accepts_volunteers_bool" in fills and is_null_or_empty(row.get("acceptsvolunteers")):
        fills["acceptsvolunteers"] = fills["accepts_volunteers_bool"]

    return fills

# COMMAND ----------
# MAGIC %md ## 22 — Phase 12: Planning Completeness Layer (I19)

# COMMAND ----------

def phase12_planning_completeness(
    row: Dict[str, Any],
    ev: SharedEvidence,
    all_fills: Dict[str, Any],
    org_type: str,
) -> Dict[str, Any]:
    """
    I19: Planning-friendly completeness layer.
    For each critical field, classifies as: verified / inferred / missing.
    - verified: from input data or web-extracted with trust tier <= 3
    - inferred: from archetype/LLM/heuristic with no web evidence
    - missing: still null after all phases

    Returns dict with completeness metadata + field_status_json for downstream use.
    """
    critical_fields = [
        ("description",     "description"),
        ("official_phone",  "official_phone"),
        ("email",           "email"),
        ("website",         "officialWebsite"),
        ("capacity",        "capacity_int"),
        ("number_doctors",  "number_doctors_int"),
        ("year_established","year_established_int"),
        ("address_city",    "address_city"),
        ("address_region",  "address_stateOrRegion"),
        ("operator_type",   "operatorTypeId"),
    ]
    # NGO-specific fields
    if org_type == "ngo":
        critical_fields += [
            ("mission_statement", "missionstatement"),
            ("org_description",   "organizationdescription"),
            ("accepts_volunteers","accepts_volunteers_bool"),
        ]

    field_statuses: List[Dict[str, Any]] = []
    verified_count = 0
    inferred_count = 0
    missing_count = 0

    for canonical, df_col in critical_fields:
        val = row.get(df_col)
        status: FieldStatus
        source = None
        confidence = 0.0
        fill_method = None

        if is_null_or_empty(val):
            status = "missing"
            missing_count += 1
        else:
            # Determine how the value was obtained
            web_provs = ev.web_facts.get(canonical, [])
            input_non_null = not is_null_or_empty(row.get(df_col)) and df_col not in all_fills

            if input_non_null:
                # Value was in the original input data
                status = "verified"
                source = "input_data"
                confidence = 0.95
                fill_method = "input"
                verified_count += 1
            elif web_provs:
                # Value came from web evidence
                best_prov = min(web_provs, key=lambda p: p.trust_tier)
                if best_prov.trust_tier <= 3:
                    status = "verified"
                    confidence = best_prov.confidence
                    source = best_prov.source
                    fill_method = "web_extracted"
                    verified_count += 1
                else:
                    status = "inferred"
                    confidence = best_prov.confidence * 0.8
                    source = best_prov.source
                    fill_method = "web_inferred"
                    inferred_count += 1
            else:
                # Value came from archetype/LLM/deterministic
                conf_col = {
                    "capacity": "capacity_confidence",
                    "number_doctors": "doctors_confidence",
                }.get(canonical)
                conf_val = safe_str(row.get(conf_col, ""))
                if "archetype" in conf_val:
                    status = "inferred"
                    source = "archetype"
                    confidence = 0.55
                    fill_method = "archetype"
                    inferred_count += 1
                elif df_col in all_fills:
                    status = "inferred"
                    source = "llm_inferred"
                    confidence = 0.65
                    fill_method = "llm_batched"
                    inferred_count += 1
                else:
                    status = "verified"
                    source = "deterministic"
                    confidence = 0.98
                    fill_method = "deterministic"
                    verified_count += 1

        field_statuses.append({
            "field": canonical,
            "df_col": df_col,
            "status": status,
            "source": source,
            "confidence": round(confidence, 3),
            "fill_method": fill_method,
        })

    total_fields = len(critical_fields)
    planning_completeness_score = round(
        (verified_count + inferred_count * 0.6) / max(total_fields, 1), 3
    )
    data_trust_score = round(verified_count / max(total_fields, 1), 3)

    return {
        "field_status_json": json.dumps(field_statuses),
        "planning_completeness_score": planning_completeness_score,
        "data_trust_score": data_trust_score,
        "verified_field_count": verified_count,
        "inferred_field_count": inferred_count,
        "missing_field_count": missing_count,
        "planning_ready": planning_completeness_score >= 0.5,
    }

# COMMAND ----------
# MAGIC %md ## 23 — Phase 13: Critical Completeness Score + Citations (I15)

# COMMAND ----------

def phase13_critical_completeness(row: Dict[str, Any], ev: SharedEvidence) -> float:
    weights = {
        "number_doctors_int": 0.20,
        "capacity_int":        0.20,
        "description":         0.15,
        "official_phone":      0.15,
        "email":               0.10,
        "officialWebsite":     0.10,
        "year_established_int": 0.10,
    }
    score = 0.0
    for df_col, weight in weights.items():
        if not is_null_or_empty(row.get(df_col)):
            score += weight
    return round(min(1.0, score), 3)


def build_citations(
    row: Dict[str, Any],
    extracted: Dict[str, Any],
    ev: SharedEvidence,
    all_fills: Dict[str, Any],
) -> Tuple[List[str], str]:
    """
    I15: Row-level citations for every extracted claim.
    Also includes step_citations from ev.step_citations for agent-step tracing.
    """
    idp_items: List[str] = []
    citation_structs: List[Dict] = []

    def _add(field_name, snippet, source, method, confidence, step_id):
        snip = str(snippet).strip()[:100]
        citation_structs.append({
            "field": field_name,
            "snippet": snip,
            "source_column": source,
            "extraction_method": method,
            "confidence": confidence,
            "step_id": step_id,
        })
        idp_items.append(f"[{step_id}] {source} -> {field_name}: '{snip}'")

    # Clinical extraction citations
    for i, item in enumerate(extracted.get("procedure", [])[:3]):
        _add("procedure_enriched", item, "procedure_parsed", "fdr_freeform_llm_v11", 0.88, f"p3_proc_{i}")
    for i, item in enumerate(extracted.get("equipment", [])[:3]):
        _add("equipment_enriched", item, "equipment_parsed", "fdr_freeform_llm_v11", 0.87, f"p3_equip_{i}")
    for i, item in enumerate(extracted.get("capability", [])[:3]):
        _add("capability_enriched", item, "capability_parsed", "fdr_freeform_llm_v11", 0.85, f"p3_cap_{i}")

    # Web evidence citations (per field)
    for canonical, prov_list in ev.web_facts.items():
        if prov_list:
            best = min(prov_list, key=lambda p: p.trust_tier)
            _add(
                canon_to_df(canonical),
                str(best.value)[:80],
                best.source,
                best.method,
                best.confidence,
                f"p6_web_{canonical}",
            )

    # Specialty citations
    for i, spec in enumerate(ev.valid_specialties[:2]):
        _add("specialties_enriched", spec, "specialties_parsed", "fdr_taxonomy_preserved", 0.95, f"p9_spec_{i}")

    # Fill citations
    for df_col, fill_val in list(all_fills.items())[:5]:
        if df_col.startswith("_"):
            continue
        source = "l1_deterministic" if df_col in ("address_country", "operatorTypeId") else "idp_fill"
        _add(df_col, str(fill_val)[:80], source, "idp_pipeline_v11", 0.75, f"fill_{df_col}")

    if not citation_structs:
        desc = safe_str(row.get("description"))
        if desc and len(desc) > 30:
            _add("description", desc[:100], "description", "description_passthrough", 0.55, "p0_desc_fallback")

    # I15: Append step-level citations from ev.step_citations
    step_level_json = json.dumps(ev.step_citations)

    return idp_items[:15], json.dumps(citation_structs), step_level_json


def build_idp_trace(
    row: Dict[str, Any],
    extracted: Dict[str, Any],
    validation: Dict[str, Any],
    final_specs: List[str],
    ev: SharedEvidence,
    all_fills: Dict[str, Any],
    gap_intelligence: Dict[str, Any],
    planning_completeness: Dict[str, Any],
    final_completeness: float,
    run_id: str,
    t_start: float,
    org_type: str,
) -> str:
    elapsed_ms = int((time.time() - t_start) * 1000)
    l1_fills = {
        k: v for k, v in all_fills.items()
        if not k.startswith("_") and k in (
            "address_country", "address_countryCode", "address_stateOrRegion",
            "operatorTypeId", "affiliationtypeids"
        )
    }
    l2_fills = {k: v for k, v in all_fills.items() if not k.startswith("_") and k not in l1_fills}
    return json.dumps({
        "facility_id":            safe_str(row.get("unique_id")),
        "facility_name":          safe_str(row.get("name")),
        "org_type":               org_type,
        "run_id":                 run_id,
        "pipeline_version":       "idp_v11",
        "schema_version":         "gold_v12",
        "processed_at":           datetime.now(timezone.utc).isoformat(),
        "processing_time_ms":     elapsed_ms,
        "critical_completeness":  final_completeness,
        "evidence_score":         round(ev.evidence_score, 3),
        "web_sources_used":       ev.sources_used,
        # I19: Planning completeness layer
        "planning_completeness_score": planning_completeness.get("planning_completeness_score", 0.0),
        "data_trust_score":            planning_completeness.get("data_trust_score", 0.0),
        "verified_field_count":        planning_completeness.get("verified_field_count", 0),
        "inferred_field_count":        planning_completeness.get("inferred_field_count", 0),
        "missing_field_count":         planning_completeness.get("missing_field_count", 0),
        "l1_fills":               list(l1_fills.keys()),
        "l2_semantic_fills":      list(l2_fills.keys()),
        # I22: Gap intelligence
        "gap_flags":              gap_intelligence.get("gap_flags", []),
        "desert_flags":           gap_intelligence.get("desert_flags", []),
        "plausibility_flags":     gap_intelligence.get("plausibility_flags", []),
        "ngo_overlap_flags":      gap_intelligence.get("ngo_overlap_flags", []),
        "service_coverage_score": gap_intelligence.get("service_coverage_score", 0.0),
        "has_critical_gaps":      gap_intelligence.get("has_critical_gaps", False),
        "is_probable_medical_desert": gap_intelligence.get("is_probable_medical_desert", False),
        # I15: Step-level citation count
        "step_citation_count":    len(ev.step_citations),
        "fdr_prompts_used": [
            "ORGANIZATION_EXTRACTION_3CAT", "FREE_FORM_STRICT_SEPARATION",
            "ORGANIZATION_INFORMATION_E164", "CAPABILITY_VALIDATION",
            "MEDICAL_SPECIALTIES_CONSERVATIVE", "BATCHED_NULL_FILL_DOMAIN_ONLY",
        ],
        "v11_improvements": [
            "I13_strict_field_separation", "I14_three_category_org_extraction",
            "I15_step_level_citations", "I16_e164_domain_only",
            "I17_accepts_volunteers_ngo_fields", "I18_conservative_specialty",
            "I19_planning_completeness_layer", "I20_strict_facility_ngo_classifier",
            "I21_declarative_statement_enforcer", "I22_expanded_gap_intelligence",
            "I23_clean_description_extraction",
        ],
        "steps": [
            {"step": "phase0_schema_coercion_registry"},
            {"step": "phase1_org_classification", "org_type": org_type},
            {"step": "phase2_web_evidence", "sources": ev.sources_used,
             "critical_completeness": round(ev.critical_completeness, 3)},
            {"step": "phase3_freeform_extraction_strict",
             "llm_called": extracted.get("llm_called", False),
             "output": {"proc": len(extracted.get("procedure", [])),
                        "equip": len(extracted.get("equipment", [])),
                        "cap": len(extracted.get("capability", []))}},
            {"step": "phase4_l1_deterministic", "fills": list(l1_fills.keys())},
            {"step": "phase5_l2_semantic", "fills": list(l2_fills.keys())},
            {"step": "phase6_l3_web_apply"},
            {"step": "phase7_l4_batched_llm"},
            {"step": "phase8_capability_validation",
             "is_valid": validation.get("is_valid", True),
             "confidence": validation.get("confidence_score", 0.75)},
            {"step": "phase9_specialty_inference_conservative",
             "final_count": len(final_specs), "specialties": final_specs},
            {"step": "phase10_gap_intelligence_expanded",
             "gap_count": gap_intelligence.get("gap_count", 0),
             "desert_flags": gap_intelligence.get("desert_flags", [])},
            {"step": "phase11_ngo_field_population"},
            {"step": "phase12_planning_completeness",
             "score": planning_completeness.get("planning_completeness_score", 0.0),
             "trust_score": planning_completeness.get("data_trust_score", 0.0)},
            {"step": "phase13_completeness_citations",
             "final_completeness": final_completeness,
             "step_citation_count": len(ev.step_citations)},
        ],
        "total_llm_calls": (1 if extracted.get("llm_called") else 0) + 4,
    })

# COMMAND ----------
# MAGIC %md ## 24 — Per-Row Pipeline

# COMMAND ----------

def process_single_row(row_dict: Dict[str, Any], run_id: str) -> Dict[str, Any]:
    """Complete IDP v11 pipeline for one row."""
    row_d = row_dict.copy()
    t_start = time.time()

    try:
        # ── PHASE 0: Schema coercion ──────────────────────────────────────────
        row_d = normalise_row_keys(row_d)

        STRING_COLS = [
            "name", "description", "city_clean", "address_city", "address_line1",
            "address_line2", "address_stateOrRegion", "address_country",
            "address_countryCode", "source_url", "email", "official_phone",
            "officialWebsite", "missionstatement", "organizationdescription",
            "twitterlink", "instagramlink", "facebooklink", "linkedinlink", "logo",
            "region_normalised", "facility_type_clean", "facility_type_clean_pdf",
            "organization_type_clean", "organization_category", "ownership_model",
            "facility_tier_label", "facility_complexity_level", "operational_status",
            "dedup_key", "canonical_source_group", "ghost_review_priority",
            "desert_label", "geo_source", "region_source", "source_trust",
            "address_type", "capacity_confidence", "doctors_confidence", "year_confidence",
            "pk_unique_id_int", "capability_graph_nodes", "capability_graph_edges",
            "capability_dependency_gaps", "capability_graph_summary", "capability_graph_version",
        ]
        BOOL_COLS = [
            "is_hospital", "is_clinic", "is_ngo", "is_public", "is_private",
            "is_faith_based", "is_government", "is_operational", "is_duplicate_survivor",
            "is_generated_canonical", "is_teaching_hospital", "is_referral_center",
            "is_military_hospital", "is_specialist_hospital",
            "has_procedures", "has_equipment", "has_capabilities", "has_specialties",
            "has_description", "has_contact", "is_rag_ready", "is_search_ready",
            "is_planning_ready", "is_clinical_ready",
            "has_emergency_medicine", "has_obstetrics", "has_surgery", "has_pediatrics",
            "has_icu", "has_radiology", "has_infectious_disease", "has_mental_health",
            "accepts_volunteers_bool", "ngo_serves_ghana",
            "stat_anomaly_capability_inflation", "stat_anomaly_hospital_no_doctors",
            "stat_anomaly_clinic_claims_icu", "stat_anomaly_ghost_facility",
            "stat_anomaly_specialty_mismatch", "stat_anomaly_procedure_breadth",
            "has_physical_address", "has_bare_website_domain", "has_multiple_phones",
            "geo_contradiction_flag", "geo_region_mismatch", "organization_category_inferred",
        ]
        NUMERIC_COLS = [
            "number_doctors_int", "capacity_int", "area_int", "year_established_int",
            "latitude", "longitude", "facility_type_confidence", "region_confidence",
            "geo_confidence", "data_completeness_score", "clinical_complexity_score",
            "ghost_probability_score", "geo_quality_score", "evidence_weight",
            "rag_quality_score", "medical_desert_score", "emergency_readiness_score",
            "critical_care_score", "quality_risk_score", "clinical_risk_score",
            "operational_risk_score", "integrity_risk_score",
            "clinical_completeness", "location_completeness", "contact_completeness",
            "service_richness_score", "infrastructure_completeness_score",
            "referral_complexity_score", "healthcare_maturity_score",
        ]

        for col in STRING_COLS:
            if col in row_d:
                v = row_d[col]
                row_d[col] = (
                    safe_str(v)
                    if not isinstance(v, list)
                    else " ".join(str(x) for x in v if x)
                )

        for col in BOOL_COLS:
            if col in row_d:
                v = row_d[col]
                if v is None:
                    row_d[col] = None
                else:
                    try:
                        if pd.isna(v):
                            row_d[col] = None
                            continue
                    except (TypeError, ValueError):
                        pass
                    s = str(v).strip().lower()
                    row_d[col] = (
                        True  if s in ("true",  "1", "yes") else
                        False if s in ("false", "0", "no")  else None
                    )

        for col in NUMERIC_COLS:
            if col in row_d:
                v = row_d[col]
                row_d[col] = None if isinstance(v, list) else safe_float(v)

        for col in [
            "specialties_parsed", "procedure_parsed", "equipment_parsed",
            "capability_parsed", "phone_numbers", "phone_numbers_parsed",
            "affiliationtypeids_parsed", "countries_parsed", "websites_parsed",
            "row_quality_flags",
        ]:
            if col in row_d:
                row_d[col] = ensure_list(row_d[col])

        if "citations" in row_d:
            v = row_d["citations"]
            row_d["citations"] = (
                json.dumps(v) if isinstance(v, list) else (safe_str(v) or "[]")
            )

        # ── PHASE 1: Org Classification (I20: strict) ─────────────────────────
        org_type = phase1_classify_org(row_d)

        # ── PHASE 2: Build SharedEvidence ─────────────────────────────────────
        ev = build_shared_evidence(row_d)

        # ── PHASE 3: LLM Free-Form Extraction (I13, I21) ──────────────────────
        needs_llm = (
            bool(ev.clinical_text.strip())
            and (
                len(ev.procedures_clean) < 3
                or len(ev.equipment_clean) == 0
                or len(ev.capabilities_clean) < 2
                or (not ev.valid_specialties and len(safe_str(row_d.get("description"))) > 30)
            )
        )
        extracted = (
            phase2_extract_freeform(row_d, ev)
            if needs_llm
            else {
                "procedure":  apply_declarative_style(ev.procedures_clean, "procedure"),
                "equipment":  apply_declarative_style(ev.equipment_clean, "equipment"),
                "capability": apply_declarative_style(ev.capabilities_clean, "capability"),
                "llm_called": False,
            }
        )

        # ── PHASE 4 (L1): Deterministic fills ─────────────────────────────────
        l1_fills = phase4_l1_deterministic(row_d)
        for k, v in l1_fills.items():
            if is_null_or_empty(row_d.get(k)):
                row_d[k] = v

        # ── PHASE 5 (L2): Semantic / ontology fills ────────────────────────────
        l2_fills = phase5_l2_semantic(row_d, extracted, ev)
        kg_specialties = l2_fills.pop("_kg_specialties", [])
        for k, v in l2_fills.items():
            if is_null_or_empty(row_d.get(k)):
                row_d[k] = v

        # ── PHASE 6 (L3): Web evidence apply ──────────────────────────────────
        l3_fills = phase6_l3_web_apply(row_d, ev)
        for k, v in l3_fills.items():
            if is_null_or_empty(row_d.get(k)):
                row_d[k] = v

        try:
            ev.commit_reconciled_values(row_d)
            ev.critical_completeness = ev.compute_critical_completeness(row_d)
        except Exception:
            pass

        # ── Org info LLM fill ──────────────────────────────────────────────────
        org_fill = phase3_org_info_fillin(row_d, ev, org_type)
        for camel_key, val in org_fill.items():
            df_col = _PYDANTIC_TO_DELTA.get(camel_key, camel_key)
            for canonical, spec in FIELD_REGISTRY.items():
                if spec.pydantic_field == camel_key:
                    df_col = spec.df_col
                    break
            if is_null_or_empty(row_d.get(df_col)):
                row_d[df_col] = val

        # ── PHASE 7 (L4): Batched LLM fill ────────────────────────────────────
        l4_fills = phase7_l4_batched_llm(row_d, ev)
        for k, v in l4_fills.items():
            if is_null_or_empty(row_d.get(k)):
                row_d[k] = v

        # ── Description consolidation (I23) ────────────────────────────────────
        desc_consolidation = _consolidate_descriptions(row_d, ev)
        for k, v in desc_consolidation.items():
            if v and len(str(v)) >= 10:
                row_d[k] = v

        try:
            ev.commit_reconciled_values(row_d)
            ev.critical_completeness = ev.compute_critical_completeness(row_d)
        except Exception:
            pass

        all_fills = {**l1_fills, **l2_fills, **l3_fills, **l4_fills, **desc_consolidation}

        # ── PHASE 8: Capability Validation ─────────────────────────────────────
        validation = phase8_validate_capability(row_d, extracted)

        if row_d.get("is_hospital") is True:
            nd = row_d.get("number_doctors_int")
            row_d["stat_anomaly_hospital_no_doctors"] = (
                nd is not None and not is_null_or_empty(nd) and float(nd) == 0.0
            )
        anomaly_cols = [
            "stat_anomaly_capability_inflation", "stat_anomaly_hospital_no_doctors",
            "stat_anomaly_clinic_claims_icu", "stat_anomaly_ghost_facility",
            "stat_anomaly_specialty_mismatch", "stat_anomaly_procedure_breadth",
        ]
        row_d["total_stat_anomalies"] = int(
            sum(bool(row_d.get(c)) for c in anomaly_cols if c in row_d)
        )

        # ── PHASE 9: Specialty Inference (I18: conservative) ───────────────────
        final_specs = phase9_infer_specialties(row_d, extracted, ev, kg_specialties)

        # ── PHASE 10: Medical Gap Intelligence (I22: expanded) ─────────────────
        gap_intelligence = phase10_medical_gap_intelligence(row_d, extracted, final_specs)

        # ── PHASE 11: NGO Field Population (I17) ───────────────────────────────
        ngo_fills = phase11_ngo_field_population(row_d, ev, org_type)
        for k, v in ngo_fills.items():
            if is_null_or_empty(row_d.get(k)):
                row_d[k] = v
        all_fills.update(ngo_fills)

        # ── PHASE 12: Planning Completeness Layer (I19) ────────────────────────
        planning_completeness = phase12_planning_completeness(row_d, ev, all_fills, org_type)

        # ── PHASE 13: Critical Completeness + Citations (I15) ─────────────────
        final_completeness = phase13_critical_completeness(row_d, ev)
        idp_citations, citations_json, step_citations_json = build_citations(
            row_d, extracted, ev, all_fills
        )
        idp_trace = build_idp_trace(
            row_d, extracted, validation, final_specs, ev,
            all_fills, gap_intelligence, planning_completeness,
            final_completeness, run_id, t_start, org_type,
        )

        # ── Write IDP output columns ───────────────────────────────────────────
        row_d["procedure_enriched"]    = json.dumps(extracted.get("procedure", []))
        row_d["equipment_enriched"]    = json.dumps(extracted.get("equipment", []))
        row_d["capability_enriched"]   = json.dumps(extracted.get("capability", []))
        row_d["capability_is_valid"]   = validation["is_valid"]
        row_d["capability_anomalies"]  = json.dumps(validation["anomalies"])
        row_d["capability_confidence"] = float(validation["confidence_score"])
        row_d["specialties_enriched"]  = json.dumps(final_specs)
        row_d["idp_trace"]             = idp_trace
        row_d["idp_run_id"]            = run_id
        row_d["_idp_processed"]        = datetime.now(timezone.utc).isoformat()
        row_d["idp_citations"]         = idp_citations
        row_d["citations"]             = citations_json

        # I15: step-level citations stored in idp_trace (already included)
        # I19: planning completeness fields
        row_d["_planning_completeness_score"] = planning_completeness.get("planning_completeness_score", 0.0)
        row_d["_data_trust_score"] = planning_completeness.get("data_trust_score", 0.0)
        row_d["_field_status_json"] = planning_completeness.get("field_status_json", "[]")

        row_d["_meta_llm_calls"]    = (1 if extracted.get("llm_called") else 0) + 4
        row_d["_meta_null_fills"]   = len(all_fills)
        row_d["_meta_web_sources"]  = len(ev.sources_used)
        row_d["_meta_completeness"] = round(final_completeness, 3)
        row_d["_meta_gap_count"]    = gap_intelligence.get("gap_count", 0)
        row_d["_meta_proc_ms"]      = int((time.time() - t_start) * 1000)

    except Exception as exc:
        name_str = safe_str(row_d.get("name", "?"))[:35]
        print(f"  [WARNING] Error [{name_str}]: {exc}")
        import traceback
        traceback.print_exc()
        row_d["procedure_enriched"]    = json.dumps(clean_clinical_array(row_d.get("procedure_parsed")))
        row_d["equipment_enriched"]    = json.dumps(clean_clinical_array(row_d.get("equipment_parsed")))
        row_d["capability_enriched"]   = json.dumps(clean_capability_strict(row_d.get("capability_parsed")))
        row_d["capability_is_valid"]   = None
        row_d["capability_anomalies"]  = "[]"
        row_d["capability_confidence"] = 0.0
        row_d["specialties_enriched"]  = json.dumps([
            s for s in ensure_list(row_d.get("specialties_parsed"))
            if s in _FDR_VALID_SPECIALTIES
        ])
        row_d["idp_trace"]      = json.dumps({"error": str(exc)[:200], "pipeline_version": "idp_v11"})
        row_d["idp_run_id"]     = run_id
        row_d["_idp_processed"] = datetime.now(timezone.utc).isoformat()
        row_d["idp_citations"]  = []
        if not isinstance(row_d.get("citations"), str):
            row_d["citations"] = "[]"
        row_d["_planning_completeness_score"] = 0.0
        row_d["_data_trust_score"] = 0.0
        row_d["_field_status_json"] = "[]"
        row_d.update({
            "_meta_llm_calls": 0, "_meta_null_fills": 0,
            "_meta_web_sources": 0, "_meta_completeness": 0.0,
            "_meta_gap_count": 0, "_meta_proc_ms": int((time.time() - t_start) * 1000),
        })

    return row_d

# COMMAND ----------
# MAGIC %md ## 25 — Main Pipeline Orchestration (Parallel)

# COMMAND ----------

mlflow.set_experiment(cfg.MLFLOW_EXP)

gold_df = spark.table(cfg.GOLD_TABLE)
if cfg.TEST_MODE:
    gold_df = gold_df.limit(cfg.TEST_ROWS)
    print(f"  TEST MODE: processing first {cfg.TEST_ROWS} rows")

gold_pd = gold_df.toPandas()
total_rows = len(gold_pd)

for col in [
    "number_doctors_int", "capacity_int", "area_int", "year_established_int",
    "clinical_complexity_score", "ghost_probability_score", "geo_quality_score",
    "evidence_weight", "rag_quality_score", "medical_desert_score",
    "emergency_readiness_score", "critical_care_score",
    "quality_risk_score", "clinical_risk_score", "operational_risk_score",
    "integrity_risk_score", "clinical_completeness", "location_completeness",
    "contact_completeness", "data_completeness_score",
]:
    if col in gold_pd.columns:
        gold_pd[col] = pd.to_numeric(gold_pd[col], errors="coerce")

print(f"\n[IDP v11] Processing {total_rows:,} facilities — MAX_WORKERS={cfg.MAX_WORKERS}")
print(f"[IDP v11] Input columns: {len(gold_pd.columns)}")

rows_input: List[Dict[str, Any]] = gold_pd.to_dict(orient="records")

with mlflow.start_run(run_name="04_idp_agent_v11") as parent_run:
    parent_run_id = parent_run.info.run_id
    mlflow.set_tag("pipeline_version", "idp_v11")
    mlflow.set_tag("schema_version", "gold_v12")
    mlflow.set_tag("key_improvements",
                   "strict_field_sep+e164+3cat_org+conservative_specialty+planning_completeness")
    mlflow.log_param("total_facilities", total_rows)
    mlflow.log_param("max_workers", cfg.MAX_WORKERS)
    mlflow.log_param("test_mode", str(cfg.TEST_MODE))

    results: List[Dict[str, Any]] = []
    completed = error_count = 0
    total_llm_calls = total_null_fills = total_web_sources = total_gaps = 0
    t_pipeline_start = time.time()

    with ThreadPoolExecutor(max_workers=cfg.MAX_WORKERS) as executor:
        futures = {
            executor.submit(process_single_row, row, parent_run_id): i
            for i, row in enumerate(rows_input)
        }

        for future in as_completed(futures):
            row_idx = futures[future]
            try:
                result = future.result()
                total_llm_calls   += result.pop("_meta_llm_calls", 0)
                total_null_fills  += result.pop("_meta_null_fills", 0)
                total_web_sources += result.pop("_meta_web_sources", 0)
                total_gaps        += result.pop("_meta_gap_count", 0)
                result.pop("_meta_completeness", None)
                result.pop("_meta_proc_ms", None)
                results.append(result)
            except Exception as exc:
                error_count += 1
                print(f"  [WARNING] Future error row {row_idx}: {exc}")
                row_d = rows_input[row_idx].copy()
                row_d.update({
                    "procedure_enriched":  "[]",
                    "equipment_enriched":  "[]",
                    "capability_enriched": "[]",
                    "capability_is_valid": None,
                    "capability_anomalies": "[]",
                    "capability_confidence": 0.0,
                    "specialties_enriched": "[]",
                    "idp_trace": json.dumps({"error": str(exc)[:200], "pipeline_version": "idp_v11"}),
                    "idp_run_id": parent_run_id,
                    "_idp_processed": datetime.now(timezone.utc).isoformat(),
                    "idp_citations": [],
                    "_planning_completeness_score": 0.0,
                    "_data_trust_score": 0.0,
                    "_field_status_json": "[]",
                })
                if not isinstance(row_d.get("citations"), str):
                    row_d["citations"] = "[]"
                results.append(row_d)

            completed += 1
            if completed % cfg.BATCH_SIZE == 0 or completed == total_rows:
                elapsed = time.time() - t_pipeline_start
                rate = completed / elapsed if elapsed > 0 else 0
                eta  = (total_rows - completed) / rate if rate > 0 else 0
                print(
                    f"  [{completed:>5}/{total_rows}] "
                    f"llm={total_llm_calls}  fills={total_null_fills}  "
                    f"web={total_web_sources}  gaps={total_gaps}  "
                    f"errors={error_count}  rate={rate:.1f}r/s  ETA~{eta/60:.1f}min"
                )

    total_wall = time.time() - t_pipeline_start
    mlflow.log_metric("total_processed",   total_rows)
    mlflow.log_metric("total_llm_calls",   total_llm_calls)
    mlflow.log_metric("total_null_fills",  total_null_fills)
    mlflow.log_metric("total_web_sources", total_web_sources)
    mlflow.log_metric("total_gaps_found",  total_gaps)
    mlflow.log_metric("error_count",       error_count)
    mlflow.log_metric("wall_seconds",      round(total_wall, 1))
    mlflow.log_metric("rows_per_second",   round(total_rows / max(total_wall, 1), 3))

print(f"\n[IDP v11] Pipeline complete in {total_wall:.1f}s. Building DataFrame ({len(results):,} rows)...")

# COMMAND ----------
# MAGIC %md ## 26 — Write gold_idp_enriched (190-Column Schema)

# COMMAND ----------

results_pd = pd.DataFrame(results)

# idp_citations -> list
if "idp_citations" in results_pd.columns:
    results_pd["idp_citations"] = results_pd["idp_citations"].apply(
        lambda x: x if isinstance(x, list) else ensure_list(x)
    )

if "phone_numbers" in results_pd.columns:
    results_pd["phone_numbers"] = results_pd["phone_numbers"].apply(ensure_list)

if "citations" in results_pd.columns:
    results_pd["citations"] = results_pd["citations"].apply(
        lambda x: (
            x if isinstance(x, str)
            else json.dumps(ensure_list(x) if isinstance(x, list) else [])
        )
    )

# Boolean coercion
_ALL_BOOL_COLS = [
    "is_hospital", "is_clinic", "is_ngo", "is_public", "is_private",
    "is_faith_based", "is_government", "is_operational", "is_duplicate_survivor",
    "is_generated_canonical", "is_teaching_hospital", "is_referral_center",
    "is_military_hospital", "is_specialist_hospital",
    "has_procedures", "has_equipment", "has_capabilities", "has_specialties",
    "has_description", "has_contact", "is_rag_ready", "is_search_ready",
    "is_planning_ready", "is_clinical_ready",
    "has_emergency_medicine", "has_obstetrics", "has_surgery", "has_pediatrics",
    "has_icu", "has_radiology", "has_infectious_disease", "has_mental_health",
    "accepts_volunteers_bool", "ngo_serves_ghana",
    "stat_anomaly_capability_inflation", "stat_anomaly_hospital_no_doctors",
    "stat_anomaly_clinic_claims_icu", "stat_anomaly_ghost_facility",
    "stat_anomaly_specialty_mismatch", "stat_anomaly_procedure_breadth",
    "has_physical_address", "has_bare_website_domain", "has_multiple_phones",
    "geo_contradiction_flag", "geo_region_mismatch", "organization_category_inferred",
    "capability_is_valid",
]
for col in _ALL_BOOL_COLS:
    if col in results_pd.columns:
        results_pd[col] = results_pd[col].map(
            lambda x: (
                True  if str(x).strip().lower() in ("true",  "1", "yes") else
                False if str(x).strip().lower() in ("false", "0", "no")  else None
            )
        )

for col in ["area_int", "year_established_int", "capacity_int", "number_doctors_int"]:
    if col in results_pd.columns:
        results_pd[col] = pd.array(results_pd[col], dtype=pd.Int32Dtype())

results_spark = spark.createDataFrame(results_pd)

VOID_AND_TYPE_CASTS: Dict[str, str] = {
    "area_int":                "int",
    "year_established_int":    "int",
    "capacity_int":            "int",
    "number_doctors_int":      "int",
    "capability_is_valid":     "boolean",
    "accepts_volunteers_bool": "boolean",
    "twitterlink":             "string",
    "instagramlink":           "string",
    "organizationdescription": "string",
    "facebooklink":            "string",
    "linkedinlink":            "string",
    "logo":                    "string",
    "address_line3":           "string",
    "address_zipOrPostcode":   "string",
    "missionstatementlink":    "string",
    "postal_address":          "string",
    "area":                    "string",
    "websites":                "string",
    "numberDoctors":           "int",
    "region_confidence":       "float",
    "data_completeness_score": "float",
    "facility_type_confidence": "double",
    "_planning_completeness_score": "double",
    "_data_trust_score":            "double",
    "_field_status_json":           "string",
    "capability_graph_nodes":       "string",
    "capability_graph_edges":       "string",
    "capability_dependency_gaps":   "string",
    "capability_graph_summary":     "string",
    "capability_graph_version":     "string",
    "service_richness_score":       "double",
    "infrastructure_completeness_score": "double",
    "referral_complexity_score":    "double",
    "healthcare_maturity_score":    "double",
}
for col_name, target_type in VOID_AND_TYPE_CASTS.items():
    if col_name in results_spark.columns:
        results_spark = results_spark.withColumn(col_name, F.col(col_name).cast(target_type))

if "citations" in results_spark.columns:
    results_spark = results_spark.withColumn(
        "citations",
        F.when(F.col("citations").isNull(), F.lit("[]"))
         .otherwise(F.col("citations").cast(StringType()))
    )

for col_name in [
    "specialties_parsed", "procedure_parsed", "equipment_parsed",
    "capability_parsed", "phone_numbers_parsed", "affiliationtypeids_parsed",
    "countries_parsed", "websites_parsed", "phone_numbers",
    "row_quality_flags", "idp_citations",
]:
    if col_name in results_spark.columns:
        results_spark = results_spark.withColumn(
            col_name,
            F.when(F.col(col_name).isNull(), F.array().cast(ArrayType(StringType())))
             .otherwise(F.expr(f"transform({col_name}, x -> cast(x as string))"))
        )

_MISSING_COL_TYPES: Dict[str, Any] = {
    "procedure_count":              IntegerType(),
    "equipment_count":              IntegerType(),
    "capability_count":             IntegerType(),
    "specialty_count":              IntegerType(),
    "phone_count":                  IntegerType(),
    "quality_flag_count":           IntegerType(),
    "doc_text_length":              IntegerType(),
    "dedup_cluster_size":           LongType(),
    "total_stat_anomalies":         IntegerType(),
    "specialty_direct_count":       IntegerType(),
    "specialty_inferred_count":     IntegerType(),
    "geo_precision_tier":           IntegerType(),
    "has_multiple_phones":          BooleanType(),
    "organization_category_inferred": BooleanType(),
    "is_teaching_hospital":         BooleanType(),
    "is_referral_center":           BooleanType(),
    "is_military_hospital":         BooleanType(),
    "is_specialist_hospital":       BooleanType(),
    "geo_contradiction_flag":       BooleanType(),
    "geo_region_mismatch":          BooleanType(),
    "is_search_ready":              BooleanType(),
    "is_planning_ready":            BooleanType(),
    "is_clinical_ready":            BooleanType(),
    "ngo_serves_ghana":             BooleanType(),
    "clinical_complexity_score":    DoubleType(),
    "ghost_probability_score":      DoubleType(),
    "geo_quality_score":            DoubleType(),
    "evidence_weight":              DoubleType(),
    "rag_quality_score":            DoubleType(),
    "medical_desert_score":         DoubleType(),
    "emergency_readiness_score":    DoubleType(),
    "critical_care_score":          DoubleType(),
    "service_richness_score":       DoubleType(),
    "infrastructure_completeness_score": DoubleType(),
    "referral_complexity_score":     DoubleType(),
    "healthcare_maturity_score":     DoubleType(),
    "quality_risk_score":           DoubleType(),
    "clinical_risk_score":          DoubleType(),
    "operational_risk_score":       DoubleType(),
    "integrity_risk_score":         DoubleType(),
    "clinical_completeness":        DoubleType(),
    "location_completeness":        DoubleType(),
    "contact_completeness":         DoubleType(),
    "organization_category_confidence": StringType(),
    "organization_category_source":     StringType(),
    "ownership_model":                  StringType(),
    "facility_complexity_level":        StringType(),
    "facility_tier_label":              StringType(),
    "ghost_review_priority":            StringType(),
    "desert_label":                     StringType(),
    "capability_graph_nodes":           StringType(),
    "capability_graph_edges":           StringType(),
    "capability_dependency_gaps":       StringType(),
    "capability_graph_summary":         StringType(),
    "capability_graph_version":         StringType(),
    "citation_row_id":                  StringType(),
    "_planning_completeness_score":     DoubleType(),
    "_data_trust_score":                DoubleType(),
    "_field_status_json":               StringType(),
}

# 190-column output schema (179 source + 11 IDP)
IDP_ENRICHED_COLUMNS = [
    "region_normalised", "unique_id", "source_url", "name", "pk_unique_id",
    "mongo_db", "specialties", "procedure", "equipment", "capability",
    "organization_type", "content_table_id", "phone_numbers", "email",
    "websites", "officialWebsite", "yearestablished", "acceptsvolunteers",
    "facebooklink", "twitterlink", "linkedinlink", "instagramlink", "logo",
    "address_line1", "address_line2", "address_line3", "address_city",
    "address_stateOrRegion", "address_zipOrPostcode", "address_country",
    "address_countryCode", "countries", "missionstatement", "missionstatementlink",
    "organizationdescription", "facilityTypeId", "operatorTypeId", "affiliationtypeids",
    "description", "area", "numberDoctors", "capacity", "ingested_at", "source_file",
    "dataset_version", "country_scope", "row_hash",
    "specialties_parsed", "procedure_parsed", "equipment_parsed", "capability_parsed",
    "phone_numbers_parsed", "affiliationtypeids_parsed", "countries_parsed", "websites_parsed",
    "official_phone", "area_int", "year_established_int", "year_confidence",
    "accepts_volunteers_bool", "pk_unique_id_int",
    "facility_type_raw", "operator_type_raw", "facility_type_clean", "facility_type_clean_pdf",
    "facility_type_confidence", "organization_type_clean", "organization_category",
    "is_ngo", "is_faith_based", "is_government", "city_clean", "region_source",
    "region_confidence", "latitude", "longitude", "geo_source", "geo_confidence",
    "postal_address", "has_physical_address", "address_type",
    "capacity_int", "capacity_confidence", "number_doctors_int", "doctors_confidence",
    "operational_status", "is_operational", "source_trust", "has_bare_website_domain",
    "dedup_key", "dedup_cluster_size", "is_duplicate_survivor", "is_generated_canonical",
    "canonical_source_group",
    "has_procedures", "has_equipment", "has_capabilities", "has_specialties",
    "has_description", "has_contact", "procedure_count", "equipment_count",
    "capability_count", "specialty_count", "phone_count", "has_multiple_phones",
    "doc_text", "doc_text_length", "is_rag_ready",
    "citations",
    "row_quality_flags", "quality_flag_count", "data_completeness_score",
    "extraction_version",
    "organization_category_confidence", "organization_category_source",
    "organization_category_inferred", "ownership_model",
    "has_emergency_medicine", "has_obstetrics", "has_surgery", "has_pediatrics",
    "has_icu", "has_radiology", "has_infectious_disease", "has_mental_health",
    "specialty_direct_count", "specialty_inferred_count",
    "is_public", "is_private", "is_hospital", "is_clinic",
    "is_teaching_hospital", "is_referral_center", "is_military_hospital", "is_specialist_hospital",
    "facility_complexity_level", "clinical_complexity_score", "facility_tier_label",
    "geo_precision_tier", "geo_quality_score", "geo_contradiction_flag", "geo_region_mismatch",
    "evidence_weight",
    "stat_anomaly_capability_inflation", "stat_anomaly_hospital_no_doctors",
    "stat_anomaly_clinic_claims_icu", "stat_anomaly_ghost_facility",
    "stat_anomaly_specialty_mismatch", "stat_anomaly_procedure_breadth",
    "total_stat_anomalies",
    "ghost_probability_score", "ghost_review_priority",
    "quality_risk_score", "clinical_risk_score", "operational_risk_score", "integrity_risk_score",
    "clinical_completeness", "location_completeness", "contact_completeness",
    "ngo_serves_ghana", "citation_row_id",
    "rag_quality_score", "is_search_ready", "is_planning_ready", "is_clinical_ready",
    "medical_desert_score", "desert_label",
    "emergency_readiness_score", "critical_care_score",
    "capability_graph_nodes", "capability_graph_edges",
    "capability_dependency_gaps", "capability_graph_summary",
    "service_richness_score", "infrastructure_completeness_score",
    "referral_complexity_score", "healthcare_maturity_score",
    "capability_graph_version",
    # 11 IDP additions
    "procedure_enriched",
    "equipment_enriched",
    "capability_enriched",
    "capability_is_valid",
    "capability_anomalies",
    "capability_confidence",
    "specialties_enriched",
    "idp_trace",
    "idp_run_id",
    "_idp_processed",
    "idp_citations",
]
assert len(IDP_ENRICHED_COLUMNS) == 190, f"Expected 190 cols, got {len(IDP_ENRICHED_COLUMNS)}"

present = set(results_spark.columns)
missing_cols = [c for c in IDP_ENRICHED_COLUMNS if c not in present]
if missing_cols:
    print(f"  Adding {len(missing_cols)} NULL columns: {missing_cols[:15]}{'...' if len(missing_cols) > 15 else ''}")
    for mc in missing_cols:
        target_type = _MISSING_COL_TYPES.get(mc, StringType())
        results_spark = results_spark.withColumn(mc, F.lit(None).cast(target_type))

extra_cols = [c for c in present if c not in IDP_ENRICHED_COLUMNS and not c.startswith("_meta_")]
if extra_cols:
    print(f"  Dropping {len(extra_cols)} extra columns: {extra_cols[:10]}")

final_spark = results_spark.select(*IDP_ENRICHED_COLUMNS)
print(f"\nColumn count: {len(final_spark.columns)} (expected 190)")
assert len(final_spark.columns) == 190, f"Column mismatch: {len(final_spark.columns)}"

(
    final_spark.write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .option("delta.autoOptimize.optimizeWrite", "true")
    .option("delta.autoOptimize.autoCompact", "true")
    .saveAsTable(cfg.IDP_OUT_TABLE)
)

final_count = spark.table(cfg.IDP_OUT_TABLE).count()
print(f"\n[OK] Written: {cfg.IDP_OUT_TABLE}")
print(f"    Rows             : {final_count:,}")
print(f"    Columns          : 190 (179 source + 11 IDP)")
print(f"    Total LLM calls  : {total_llm_calls:,}  (avg {total_llm_calls/max(total_rows,1):.1f}/row)")
print(f"    Total fills      : {total_null_fills:,}  (avg {total_null_fills/max(total_rows,1):.1f}/row)")
print(f"    Total web sources: {total_web_sources:,}")
print(f"    Gap flags found  : {total_gaps:,}")
print(f"    Errors           : {error_count:,}")
print(f"    Wall time        : {total_wall:.1f}s  ({total_rows/max(total_wall,1):.2f} rows/s)")
print(f"    MLflow run       : {parent_run_id}")

spark.sql(f"""
    COMMENT ON TABLE {cfg.IDP_OUT_TABLE}
    IS 'IDP v11: Schema-governed healthcare intelligence engine. '
       'I13 strict field separation + I14 3-category org extraction + '
       'I15 step-level citations + I16 E164/domain-only + '
       'I17 acceptsVolunteers/NGO fields + I18 conservative specialty + '
       'I19 planning completeness layer + I20 strict classifier + '
       'I21 declarative statements + I22 expanded gap intelligence + '
       'I23 clean description extraction. '
       '179 source + 11 IDP = 190 cols, including capability dependency graph fields.'
""")

# COMMAND ----------
# MAGIC %md ## 27 — Quality Validation Report

# COMMAND ----------

idp   = spark.table(cfg.IDP_OUT_TABLE)
total = idp.count()

print(f"{'='*72}")
print(f"GOLD IDP ENRICHED v11 — QUALITY REPORT  ({total:,} rows | {len(idp.columns)} cols)")
print(f"{'='*72}")


def _pct_nonempty_json(col_name):
    return idp.filter(
        F.col(col_name).isNotNull()
        & (F.col(col_name) != "[]")
        & (F.col(col_name) != "null")
        & (F.length(F.col(col_name)) > 2)
    ).count()


checks = [
    ("procedure_enriched",    "non-empty JSON",    _pct_nonempty_json),
    ("equipment_enriched",    "non-empty JSON",    _pct_nonempty_json),
    ("capability_enriched",   "non-empty JSON",    _pct_nonempty_json),
    ("specialties_enriched",  "non-empty JSON",    _pct_nonempty_json),
    ("capability_is_valid",   "TRUE",              lambda c: idp.filter(F.col(c) == True).count()),
    ("idp_citations",         "non-empty ARRAY",   lambda c: idp.filter(F.size(F.col(c)) > 0).count()),
    ("description",           "not null >=20",     lambda c: idp.filter(F.col(c).isNotNull() & (F.length(F.col(c)) > 20)).count()),
    ("number_doctors_int",    "not null",          lambda c: idp.filter(F.col(c).isNotNull()).count()),
    ("capacity_int",          "not null",          lambda c: idp.filter(F.col(c).isNotNull()).count()),
    ("year_established_int",  "not null",          lambda c: idp.filter(F.col(c).isNotNull()).count()),
    ("email",                 "not null",          lambda c: idp.filter(F.col(c).isNotNull()).count()),
    ("official_phone",        "not null",          lambda c: idp.filter(F.col(c).isNotNull()).count()),
    # I16: E164 validation
    ("official_phone",        "+233 E164 format",  lambda c: idp.filter(F.col(c).rlike(r"^\+233\d{9}$")).count()),
    # I16: domain-only website
    ("officialWebsite",       "domain only (no http)", lambda c: idp.filter(
        F.col(c).isNotNull() & ~F.col(c).startswith("http")
    ).count()),
    ("address_stateOrRegion", "not null",          lambda c: idp.filter(F.col(c).isNotNull()).count()),
    ("operatorTypeId",        "not null",          lambda c: idp.filter(F.col(c).isNotNull()).count()),
    ("address_country",       "= Ghana",           lambda c: idp.filter(F.col(c) == "Ghana").count()),
    ("affiliationtypeids",    "not null",          lambda c: idp.filter(F.col(c).isNotNull()).count()),
    ("missionstatement",      "not null (NGOs)",   lambda c: idp.filter(
        F.col(c).isNotNull() & F.col("is_ngo")
    ).count()),
    ("accepts_volunteers_bool","not null",         lambda c: idp.filter(F.col(c).isNotNull()).count()),
    ("citations",             "is STRING",         lambda c: idp.filter(F.col(c).isNotNull()).count()),
]

print(f"\n{'Column':<48}  {'Check':<28}  {'Count':>6}  {'%':>6}  Status")
print("-" * 100)
for col_name, label, fn in checks:
    if col_name not in idp.columns:
        print(f"  MISSING  {col_name}")
        continue
    ct   = fn(col_name)
    pct  = ct / total * 100 if total > 0 else 0.0
    stat = "[OK]" if pct >= 60 else ("[WARN]" if pct >= 20 else "[FAIL]")
    print(f"  {stat} {col_name:<46}  {label:<28}  {ct:>6,}  {pct:>5.1f}%")

print("\n-- I19 Planning Completeness Layer --")
if "idp_trace" in idp.columns:
    idp.select(
        F.get_json_object("idp_trace", "$.planning_completeness_score").cast("float").alias("plan_score"),
        F.get_json_object("idp_trace", "$.data_trust_score").cast("float").alias("trust_score"),
        F.get_json_object("idp_trace", "$.verified_field_count").cast("int").alias("verified"),
        F.get_json_object("idp_trace", "$.inferred_field_count").cast("int").alias("inferred"),
        F.get_json_object("idp_trace", "$.missing_field_count").cast("int").alias("missing"),
        F.get_json_object("idp_trace", "$.step_citation_count").cast("int").alias("step_cits"),
    ).agg(
        F.avg("plan_score").alias("avg_planning_completeness"),
        F.avg("trust_score").alias("avg_data_trust"),
        F.avg("verified").alias("avg_verified_fields"),
        F.avg("inferred").alias("avg_inferred_fields"),
        F.avg("missing").alias("avg_missing_fields"),
        F.avg("step_cits").alias("avg_step_citations"),
    ).show()

print("\n-- I22 Medical Gap Intelligence --")
for gap_kw in [
    "NO_ICU", "NO_EMERGENCY_CARE", "NO_MATERNITY", "NO_SURGERY",
    "MISSING_DOCTOR_COUNT", "MISSING_BED_CAPACITY",
    "PROBABLE_MEDICAL_DESERT", "CRITICAL_SERVICE_GAPS",
    "HIGH_GHOST_RISK", "NO_CLINICAL_EVIDENCE",
]:
    ct = idp.filter(F.col("idp_trace").contains(gap_kw)).count()
    if total > 0:
        print(f"  {gap_kw}: {ct}/{total} ({ct/total*100:.1f}%)")

print("\n-- I16 Contact Format Compliance --")
if "official_phone" in idp.columns:
    e164_ct = idp.filter(
        F.col("official_phone").isNotNull() &
        F.col("official_phone").rlike(r"^\+233\d{9}$")
    ).count()
    non_null_phone = idp.filter(F.col("official_phone").isNotNull()).count()
    print(f"  Phones in E164 format: {e164_ct}/{non_null_phone} ({e164_ct/max(non_null_phone,1)*100:.1f}%)")
if "officialWebsite" in idp.columns:
    domain_ct = idp.filter(
        F.col("officialWebsite").isNotNull() &
        ~F.col("officialWebsite").startswith("http")
    ).count()
    non_null_web = idp.filter(F.col("officialWebsite").isNotNull()).count()
    print(f"  Websites as domain-only: {domain_ct}/{non_null_web} ({domain_ct/max(non_null_web,1)*100:.1f}%)")

print("\n-- I18 Conservative Specialty Check --")
idp.agg(
    F.count(F.when(F.size(F.col("specialties_parsed")) > 0, True)).alias("had_original"),
    F.count(F.when(
        F.col("specialties_enriched").isNotNull() & (F.col("specialties_enriched") != "[]"), True
    )).alias("have_enriched"),
    F.avg(F.get_json_object("idp_trace", "$.service_coverage_score").cast("float")).alias("avg_service_coverage"),
).show()

print("\n-- I15 Citation Coverage --")
idp.agg(
    F.avg(F.size(F.col("idp_citations"))).alias("avg_row_citations"),
    F.count(F.when(F.size(F.col("idp_citations")) > 0, True)).alias("rows_with_citations"),
    F.count(F.when(F.col("citations").isNotNull() & (F.col("citations") != "[]"), True))
     .alias("rows_with_structured_citations"),
).show()

# print("-- Schema type verification --")
# schema_dict = {
#     field.name: field.dataType.simpleString()
#     for field in final_df.schema.fields
# }

# type_checks = [
#     ("official_phone",       "StringType"),
#     ("officialWebsite",      "StringType"),
#     ("twitterlink",          "StringType"),
#     ("instagramlink",        "StringType"),
#     ("organizationdescription","StringType"),
#     ("pk_unique_id_int",     "StringType"),
#     ("numberDoctors",        "IntegerType"),
#     ("number_doctors_int",   "IntegerType"),
#     ("capacity_int",         "IntegerType"),
#     ("citations",            "StringType"),
#     ("ghost_probability_score",  "DoubleType"),
#     ("emergency_readiness_score","DoubleType"),
#     ("region_confidence",        "FloatType"),
#     ("data_completeness_score",  "FloatType"),
# ]
# for col_name, expected_type in type_checks:
#     actual = schema_dict.get(col_name, "MISSING")
#     status = "[OK]" if expected_type.lower().replace("type", "") in actual.lower() else "[FAIL]"
#     print(f"  {status} {col_name:<38} expected={expected_type:<14} actual={actual}")

# print("\n-- Fill method breakdown (from idp_trace) --")
# idp.select(
#     F.get_json_object("idp_trace", "$.l1_fills").alias("l1"),
#     F.get_json_object("idp_trace", "$.l2_semantic_fills").alias("l2"),
#     F.get_json_object("idp_trace", "$.critical_completeness").cast("float").alias("critical_completeness"),
#     F.get_json_object("idp_trace", "$.service_coverage_score").cast("float").alias("svc_coverage"),
#     F.get_json_object("idp_trace", "$.gap_count").cast("int").alias("gap_count"),
# ).agg(
#     F.avg("critical_completeness").alias("avg_critical_completeness"),
#     F.avg("svc_coverage").alias("avg_service_coverage"),
#     F.avg("gap_count").alias("avg_gap_count"),
#     F.count(F.when(F.col("gap_count") > 0, True)).alias("rows_with_gaps"),
# ).show()

# print("-- Capability confidence distribution --")
# idp.select(
#     F.round(F.avg("capability_confidence"), 3).alias("avg"),
#     F.round(F.min("capability_confidence"), 3).alias("min"),
#     F.round(F.max("capability_confidence"), 3).alias("max"),
# ).show()

# print("-- Medical gap intelligence --")
# for gap_kw in [
#     "NO_ICU", "NO_EMERGENCY_CARE", "NO_MATERNITY", "NO_SURGERY",
#     "MISSING_DOCTOR_COUNT", "MISSING_BED_CAPACITY",
# ]:
#     ct = idp.filter(F.col("idp_trace").contains(gap_kw)).count()
#     print(f"  {gap_kw}: {ct}/{total} ({ct/total*100:.1f}%)" if total > 0 else f"  {gap_kw}: 0/0")

# print("-- L2 Semantic fill coverage --")
# for c in [
#     "address_country", "address_countryCode", "operatorTypeId",
#     "affiliationtypeids", "facility_complexity_level", "address_stateOrRegion",
# ]:
#     if c in idp.columns:
#         ct = idp.filter(F.col(c).isNotNull() & (F.trim(F.col(c)) != "")).count()
#         print(f"  {c}: {ct}/{total} ({ct/total*100:.1f}%)" if total > 0 else f"  {c}: 0/0")

# print("-- Specialty enrichment before vs after --")
# idp.agg(
#     F.count(F.when(F.size(F.col("specialties_parsed")) > 0, True)).alias("had_original"),
#     F.count(F.when(
#         F.col("specialties_enriched").isNotNull() & (F.col("specialties_enriched") != "[]"), True
#     )).alias("have_enriched"),
# ).show()


# COMMAND ----------
