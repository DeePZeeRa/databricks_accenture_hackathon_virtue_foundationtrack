USE CATALOG vf_health;
USE SCHEMA ghana;

-- 1) Bronze (raw)
CREATE TABLE IF NOT EXISTS bronze_raw_facilities (
  source_url STRING,
  name STRING,
  pk_unique_id STRING,
  `mongo DB` STRING,
  specialties STRING,
  procedure STRING,
  equipment STRING,
  capability STRING,
  organization_type STRING,
  content_table_id STRING,
  phone_numbers STRING,
  email STRING,
  websites STRING,
  officialWebsite STRING,
  yearEstablished STRING,
  acceptsVolunteers STRING,
  facebookLink STRING,
  twitterLink STRING,
  linkedinLink STRING,
  instagramLink STRING,
  logo STRING,
  address_line1 STRING,
  address_line2 STRING,
  address_line3 STRING,
  address_city STRING,
  address_stateOrRegion STRING,
  address_zipOrPostcode STRING,
  address_country STRING,
  address_countryCode STRING,
  countries STRING,
  missionStatement STRING,
  missionStatementLink STRING,
  organizationDescription STRING,
  facilityTypeId STRING,
  operatorTypeId STRING,
  affiliationTypeIds STRING,
  description STRING,
  area STRING,
  numberDoctors STRING,
  capacity STRING,
  unique_id STRING,
  ingested_at TIMESTAMP
) USING DELTA;

-- 2) Silver (clean canonical)
CREATE TABLE IF NOT EXISTS silver_facilities_clean (
  row_id STRING,
  unique_id STRING,
  source_url STRING,
  name STRING,
  organization_type STRING,
  specialties ARRAY<STRING>,
  procedure ARRAY<STRING>,
  equipment ARRAY<STRING>,
  capability ARRAY<STRING>,
  phone_numbers ARRAY<STRING>,
  email STRING,
  websites ARRAY<STRING>,
  officialWebsite STRING,
  yearEstablished INT,
  acceptsVolunteers BOOLEAN,
  facebookLink STRING,
  twitterLink STRING,
  linkedinLink STRING,
  instagramLink STRING,
  logo STRING,
  address_line1 STRING,
  address_line2 STRING,
  address_line3 STRING,
  address_city STRING,
  address_stateOrRegion STRING,
  address_zipOrPostcode STRING,
  address_country STRING,
  address_countryCode STRING,
  countries ARRAY<STRING>,
  missionStatement STRING,
  missionStatementLink STRING,
  organizationDescription STRING,
  facilityTypeId STRING,
  operatorTypeId STRING,
  affiliationTypeIds ARRAY<STRING>,
  description STRING,
  area INT,
  numberDoctors INT,
  capacity INT,
  cleaned_at TIMESTAMP
) USING DELTA;

-- 3) Gold tables
CREATE TABLE IF NOT EXISTS gold_facility_profiles (
  row_id STRING,
  unique_id STRING,
  name STRING,
  organization_type STRING,
  profile_json STRING,
  updated_at TIMESTAMP
) USING DELTA;

CREATE TABLE IF NOT EXISTS gold_facility_claims (
  claim_id STRING,
  row_id STRING,
  unique_id STRING,
  claim_type STRING,        -- procedure/equipment/capability
  claim_text STRING,
  confidence DOUBLE,
  created_at TIMESTAMP
) USING DELTA;

CREATE TABLE IF NOT EXISTS gold_citations (
  citation_id STRING,
  row_id STRING,
  source_url STRING,
  field STRING,
  evidence_text STRING,
  step_id STRING,
  created_at TIMESTAMP
) USING DELTA;

CREATE TABLE IF NOT EXISTS gold_risk_signals (
  signal_id STRING,
  row_id STRING,
  unique_id STRING,
  signal_type STRING,       -- anomaly/conflict/fraud
  signal_score DOUBLE,
  signal_flag BOOLEAN,
  reason STRING,
  created_at TIMESTAMP
) USING DELTA;

CREATE TABLE IF NOT EXISTS gold_medical_deserts (
  region STRING,
  district STRING,
  facility_count BIGINT,
  emergency_sites BIGINT,
  maternal_sites BIGINT,
  desert_score DOUBLE,
  computed_at TIMESTAMP
) USING DELTA;