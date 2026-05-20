"""SQL query service — all structured data retrieval with caching."""
from __future__ import annotations

import json
from typing import Any, Optional

import structlog

from app.core.database import DatabricksQueryExecutor
from app.services.cache_service import CacheService

logger = structlog.get_logger(__name__)

CATALOG = "virtue_foundation.ghana"


def _parse_json_col(val: Any, default: Any = None) -> Any:
    """Safely parse a JSON string column."""
    if default is None:
        default = []
    if val is None:
        return default
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        val = val.strip()
        if not val or val in ("null", "None", "[]", "{}"):
            return default
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return [val] if val else default
    return default


def _desert_color(score: float) -> str:
    if score >= 0.75:
        return "#B91C1C"
    if score >= 0.55:
        return "#EA580C"
    if score >= 0.40:
        return "#D97706"
    if score >= 0.25:
        return "#65A30D"
    return "#2563EB"


class SQLQueryService:
    """All structured Databricks SQL queries with caching."""

    # ── Facilities ─────────────────────────────────────────────────────────────

    @staticmethod
    async def get_facilities(
        region: str = "",
        facility_type: str = "",
        search: str = "",
        volunteer: bool = False,
        has_emergency: Optional[bool] = None,
        has_surgery: Optional[bool] = None,
        has_icu: Optional[bool] = None,
        has_obstetrics: Optional[bool] = None,
        has_pediatrics: Optional[bool] = None,
        has_radiology: Optional[bool] = None,
        has_infectious_disease: Optional[bool] = None,
        has_mental_health: Optional[bool] = None,
        desert_label: str = "",
        risk_level: str = "",
        limit: int = 50,
        offset: int = 0,
        data_source_header: Optional[dict] = None,
    ) -> dict:
        cache_key = CacheService.build_key(
            "facilities",
            region, facility_type, search, volunteer,
            has_emergency, has_surgery, has_icu,
            has_obstetrics, has_pediatrics, has_radiology,
            has_infectious_disease, has_mental_health,
            desert_label, risk_level,
            limit, offset,
        )
        cached = await CacheService.get(cache_key)
        if cached:
            if data_source_header is not None:
                data_source_header["source"] = "cache"
            return cached

        where: list[str] = []
        params: list = []

        if region:
            where.append("region_normalised = ?")
            params.append(region)
        if facility_type:
            where.append("LOWER(facility_type_clean) = LOWER(?)")
            params.append(facility_type)
        if search:
            where.append("LOWER(name) LIKE LOWER(?)")
            params.append(f"%{search}%")
        if volunteer:
            where.append("accepts_volunteers_bool = true")
        if has_emergency is True:
            where.append("has_emergency_medicine = true")
        if has_surgery is True:
            where.append("has_surgery = true")
        if has_icu is True:
            where.append("has_icu = true")
        if has_obstetrics is True:
            where.append("has_obstetrics = true")
        if has_pediatrics is True:
            where.append("has_pediatrics = true")
        if has_radiology is True:
            where.append("has_radiology = true")
        if has_infectious_disease is True:
            where.append("has_infectious_disease = true")
        if has_mental_health is True:
            where.append("has_mental_health = true")
        if desert_label:
            where.append("desert_label = ?")
            params.append(desert_label)

        where_clause = f"WHERE {' AND '.join(where)}" if where else ""

        count_sql = f"SELECT COUNT(*) AS total FROM {CATALOG}.gold_idp_enriched {where_clause}"
        count_result = await DatabricksQueryExecutor.execute(count_sql, params, max_rows=1)
        total = count_result[0]["total"] if count_result else 0

        data_sql = f"""
            SELECT unique_id, name, region_normalised, facility_type_clean, city_clean,
                   organization_type_clean, latitude, longitude,
                   number_doctors_int, capacity_int, data_completeness_score,
                   medical_desert_score, desert_label,
                   has_emergency_medicine, has_surgery, has_icu, has_obstetrics,
                   has_pediatrics, has_radiology, has_infectious_disease, has_mental_health,
                   is_hospital, is_clinic, is_ngo, is_public, is_private,
                   accepts_volunteers_bool, email, officialWebsite as official_website,
                   procedure_count, equipment_count, capability_count, specialty_count,
                   total_stat_anomalies, capability_is_valid
            FROM {CATALOG}.gold_idp_enriched
            {where_clause}
            ORDER BY data_completeness_score DESC NULLS LAST
            LIMIT {limit} OFFSET {offset}
        """
        items = await DatabricksQueryExecutor.execute(data_sql, params, max_rows=limit)

        result = {"total": total, "items": items}
        await CacheService.set(cache_key, result, ttl=300)
        if data_source_header is not None:
            data_source_header["source"] = "databricks"
        return result

    @staticmethod
    async def get_facility_detail(unique_id: str) -> Optional[dict]:
        cache_key = CacheService.build_key("facility_detail", unique_id)
        cached = await CacheService.get(cache_key)
        if cached:
            return cached

        sql = f"""
            SELECT
                e.unique_id,
                e.name,
                e.region_normalised,
                e.facility_type_clean,
                e.city_clean,
                e.address_line1,
                e.address_line2,
                e.address_line3,
                e.address_city,
                e.address_stateOrRegion AS address_state_or_region,
                e.address_zipOrPostcode AS address_zip_or_postcode,
                e.organization_type_clean,
                e.latitude,
                e.longitude,
                e.number_doctors_int,
                e.capacity_int,
                e.data_completeness_score,
                e.medical_desert_score,
                e.desert_label,
                e.has_emergency_medicine,
                e.has_surgery,
                e.has_icu,
                e.has_obstetrics,
                e.has_pediatrics,
                e.has_radiology,
                e.has_infectious_disease,
                e.has_mental_health,
                e.is_hospital,
                e.is_clinic,
                e.is_ngo,
                e.is_public,
                e.is_private,
                e.accepts_volunteers_bool,
                e.email,
                e.phone_numbers,
                e.official_phone,
                e.officialWebsite AS official_website,
                e.source_url,
                e.description,
                e.organizationdescription,
                e.yearestablished AS year_established,
                e.capability_is_valid,
                e.capability_confidence,
                e.capability_anomalies,
                e.total_stat_anomalies,
                e.procedure_count,
                e.equipment_count,
                e.capability_count,
                e.specialty_count,
                e.procedure_enriched,
                e.equipment_enriched,
                e.capability_enriched,
                e.specialties_enriched,
                e.idp_citations,
                e.idp_run_id,
                e._idp_processed,
                a.total_anomaly_flags,
                a.anomaly_risk_level,
                a.llm_priority_action,
                a.llm_data_quality_score,
                a.llm_confirmed_anomaly_count,
                a.llm_anomaly_severity,
                a.llm_clinical_assessment,
                a.llm_false_positive_reason,
                a.stat_anomaly_capability_inflation,
                a.stat_anomaly_hospital_no_doctors,
                a.stat_anomaly_clinic_claims_icu,
                a.stat_anomaly_ghost_facility,
                a.stat_anomaly_specialty_mismatch,
                a.stat_anomaly_procedure_breadth,
                a.enhanced_type_capability_mismatch,
                a.enhanced_ghost_hospital,
                a.enhanced_procedures_no_equipment,
                a.enhanced_low_idp_confidence,
                a.enhanced_suspicious_completeness,
                a.enhanced_icu_no_infrastructure
            FROM {CATALOG}.gold_idp_enriched e
            LEFT JOIN {CATALOG}.gold_anomaly_flags a ON e.unique_id = a.unique_id
            WHERE e.unique_id = ?
            LIMIT 1
        """
        rows = await DatabricksQueryExecutor.execute(sql, [unique_id], max_rows=1)
        if not rows:
            return None

        row = rows[0]
        # Parse JSON string columns
        for col in [
            "procedure_enriched",
            "equipment_enriched",
            "capability_enriched",
            "specialties_enriched",
            "capability_anomalies",
            "phone_numbers",
        ]:
            row[col] = _parse_json_col(row.get(col))
        for col in ["procedure_parsed", "equipment_parsed", "capability_parsed", "specialties_parsed"]:
            row[col] = _parse_json_col(row.get(col))
        row["idp_citations"] = _parse_json_col(row.get("idp_citations"))

        await CacheService.set(cache_key, row, ttl=600)
        return row

    @staticmethod
    async def get_facilities_map(
        region: str = "",
        facility_type: str = "",
        desert_only: bool = False,
        data_source_header: Optional[dict] = None,
    ) -> dict:
        cache_key = CacheService.build_key("map_v2", region, facility_type, desert_only)
        cached = await CacheService.get(cache_key)
        if cached:
            if data_source_header is not None:
                data_source_header["source"] = "cache"
            return cached

        where = [
            "latitude IS NOT NULL",
            "longitude IS NOT NULL",
            "NOT (ABS(latitude - 7.9465) < 0.001 AND ABS(longitude - (-1.0232)) < 0.001)",
        ]
        params: list = []

        if region:
            where.append("region_normalised = ?")
            params.append(region)
        if facility_type:
            where.append("LOWER(facility_type_clean) = LOWER(?)")
            params.append(facility_type)
        if desert_only:
            where.append("desert_label IN ('Critical Desert', 'Severe Desert')")

        where_clause = f"WHERE {' AND '.join(where)}"

        sql = f"""
            SELECT unique_id, name, facility_type_clean, city_clean, region_normalised,
                   latitude, longitude, medical_desert_score, desert_label,
                   has_emergency_medicine, has_surgery, has_icu, has_obstetrics,
                   has_pediatrics, has_radiology, has_infectious_disease, has_mental_health,
                     accepts_volunteers_bool, is_public, is_private, data_completeness_score,
                   number_doctors_int, capacity_int, is_hospital, is_clinic, is_ngo,
                   capability_is_valid, total_stat_anomalies,
                   capability_confidence, specialties_enriched,idp_citations
                   
            FROM {CATALOG}.gold_idp_enriched
            {where_clause}
        """
        rows = await DatabricksQueryExecutor.execute(sql, params, max_rows=2000)

        features = []
        for row in rows:
            lat = row.get("latitude") or 0
            lon = row.get("longitude") or 0
            if not lat or not lon:
                continue
            score = float(row.get("medical_desert_score") or 0)
            row["color"] = _desert_color(score)
            row["specialties_enriched"] = _parse_json_col(row.get("specialties_enriched"))
            row["idp_citations"] = _parse_json_col(row.get("idp_citations"))
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": row,
            })

        geojson = {"type": "FeatureCollection", "features": features}
        await CacheService.set(cache_key, geojson, ttl=600)
        if data_source_header is not None:
            data_source_header["source"] = "databricks"
        return geojson

    @staticmethod
    async def get_stats(data_source_header: Optional[dict] = None) -> dict:
        cache_key = "stats:dashboard"
        cached = await CacheService.get(cache_key)
        if cached:
            if data_source_header is not None:
                data_source_header["source"] = "cache"
            return cached

        import asyncio
        results = await asyncio.gather(
            DatabricksQueryExecutor.execute(
                f"""SELECT COUNT(*) AS total_facilities,
                    SUM(CASE WHEN is_hospital THEN 1 ELSE 0 END) AS hospitals,
                    SUM(CASE WHEN is_clinic THEN 1 ELSE 0 END) AS clinics,
                    SUM(CASE WHEN is_ngo THEN 1 ELSE 0 END) AS ngos,
                    SUM(CASE WHEN accepts_volunteers_bool THEN 1 ELSE 0 END) AS volunteer_facilities,
                    COUNT(DISTINCT region_normalised) AS regions_covered,
                    ROUND(AVG(data_completeness_score), 3) AS avg_completeness
                FROM {CATALOG}.gold_idp_enriched""",
                max_rows=1,
            ),
            DatabricksQueryExecutor.execute(
                f"""SELECT COUNT(*) AS critical_desert_regions
                FROM {CATALOG}.gold_medical_desert_scores
                WHERE desert_label IN ('Severe Desert', 'Moderate Desert')
                   OR mds_label IN ('Critical Desert', 'Severe Desert', 'Moderate Desert')""",
                max_rows=1,
            ),
            DatabricksQueryExecutor.execute(
                f"SELECT ROUND(AVG(medical_desert_score), 3) AS avg_desert_score FROM {CATALOG}.gold_medical_desert_scores",
                max_rows=1,
            ),
        )

        main = results[0][0] if results[0] else {}
        desert_cnt = results[1][0] if results[1] else {}
        desert_avg = results[2][0] if results[2] else {}

        stats = {
            "total_facilities": main.get("total_facilities", 0),
            "hospitals": main.get("hospitals", 0),
            "clinics": main.get("clinics", 0),
            "ngos": main.get("ngos", 0),
            "volunteer_facilities": main.get("volunteer_facilities", 0),
            "regions_covered": main.get("regions_covered", 0),
            "avg_completeness": float(main.get("avg_completeness") or 0),
            "critical_desert_regions": desert_cnt.get("critical_desert_regions", 0),
            "avg_desert_score": float(desert_avg.get("avg_desert_score") or 0),
        }
        await CacheService.set(cache_key, stats, ttl=900)
        if data_source_header is not None:
            data_source_header["source"] = "databricks"
        return stats

    @staticmethod
    async def get_regions() -> list[str]:
        cache_key = "regions:list"
        cached = await CacheService.get(cache_key)
        if cached:
            return cached
        rows = await DatabricksQueryExecutor.execute(
            f"SELECT DISTINCT region_normalised FROM {CATALOG}.gold_idp_enriched WHERE region_normalised IS NOT NULL ORDER BY region_normalised"
        )
        regions = [r["region_normalised"] for r in rows if r.get("region_normalised")]
        await CacheService.set(cache_key, regions, ttl=3600)
        return regions

    # ── Desert & Regional ──────────────────────────────────────────────────────

    @staticmethod
    async def get_desert_scores(data_source_header: Optional[dict] = None) -> list[dict]:
        cache_key = "desert:scores"
        cached = await CacheService.get(cache_key)
        if cached:
            if data_source_header is not None:
                data_source_header["source"] = "cache"
            return cached

        rows = await DatabricksQueryExecutor.execute(
            f"""SELECT region, schema_version, scored_at,
                total_facilities, hospital_count, clinic_count, ngo_count,
                volunteer_facilities, teaching_hospitals, referral_centers,
                public_facilities, private_facilities,
                total_doctors, total_beds,
                doctors_per_100k, beds_per_100k, facilities_per_100k, hospitals_per_100k,
                region_population,
                emergency_medicine_facilities, surgery_facilities, obstetrics_facilities,
                icu_facilities, pediatrics_facilities, infectious_disease_facilities,
                radiology_facilities, mental_health_facilities,
                critical_specialty_gap_count, missing_critical_specialties, all_specialties,
                emergency_gap_score, icu_gap_score, surgical_access_gap_score, maternity_gap_score,
                avg_completeness, avg_geo_quality, avg_ghost_probability, avg_quality_risk,
                total_region_anomalies, rag_ready_count, rag_ready_rate,
                density_component, specialty_component, integrity_component, confidence_component,
                summary_mds, blended_mds,
                medical_desert_score, desert_label, mds_label,
                score_confidence, score_rationale,
                centroid_lat, centroid_lon, recommended_actions, method_version
            FROM {CATALOG}.gold_medical_desert_scores
            ORDER BY medical_desert_score DESC""",
            max_rows=50,
        )
        for row in rows:
            for col in ["missing_critical_specialties", "all_specialties", "recommended_actions"]:
                row[col] = _parse_json_col(row.get(col))

        await CacheService.set(cache_key, rows, ttl=600)
        if data_source_header is not None:
            data_source_header["source"] = "databricks"
        return rows

    @staticmethod
    async def get_regional_summary(data_source_header: Optional[dict] = None) -> list[dict]:
        cache_key = "regional:summary"
        cached = await CacheService.get(cache_key)
        if cached:
            if data_source_header is not None:
                data_source_header["source"] = "cache"
            return cached

        rows = await DatabricksQueryExecutor.execute(
            f"""SELECT region_normalised, total_facilities, clinical_facility_count,
                hospital_count, clinical_hospital_count, clinic_count,
                public_facilities, private_facilities,
                ngo_count, faith_based_count, government_facilities,
                teaching_hospital_count, referral_center_count, specialist_hospital_count,
                avg_doctors, total_doctors, avg_bed_capacity, total_beds,
                avg_completeness, avg_geo_quality, avg_clinical_complexity,
                avg_evidence_weight, avg_ghost_probability,
                emergency_medicine_facilities, obstetrics_facilities,
                surgery_facilities, pediatrics_facilities, icu_facilities,
                infectious_disease_facilities, radiology_facilities, mental_health_facilities,
                facilities_with_procedures, facilities_with_equipment,
                facilities_with_capabilities, volunteer_facilities,
                region_centroid_lat, region_centroid_lon,
                total_region_anomalies,
                avg_quality_risk, avg_facility_desert_score, avg_emergency_readiness,
                avg_critical_care_score, avg_service_richness_score,
                avg_infrastructure_completeness_score, avg_referral_complexity_score,
                avg_healthcare_maturity_score,
                rag_ready_count, rag_ready_rate, clinical_ready_count,
                region_population, facilities_per_100k, hospitals_per_100k,
                beds_per_100k, doctors_per_100k, icu_facilities_per_100k,
                surgery_facilities_per_100k, maternity_facilities_per_100k,
                public_private_ratio, maternity_gap_score, emergency_gap_score,
                icu_gap_score, surgical_access_gap_score, public_private_imbalance_score,
                all_specialties, missing_critical_specialties, critical_specialty_gap_count,
                recommended_actions, medical_desert_score, desert_label
            FROM {CATALOG}.gold_regional_summary
            ORDER BY medical_desert_score DESC NULLS LAST""",
            max_rows=50,
        )
        for row in rows:
            for col in ["missing_critical_specialties", "recommended_actions", "all_specialties"]:
                row[col] = _parse_json_col(row.get(col))

        await CacheService.set(cache_key, rows, ttl=600)
        if data_source_header is not None:
            data_source_header["source"] = "databricks"
        return rows

    @staticmethod
    async def get_desert_regions() -> list[dict]:
        """Minimal region data for map heatmap overlay."""
        cache_key = "desert:regions_map"
        cached = await CacheService.get(cache_key)
        if cached:
            return cached

        rows = await DatabricksQueryExecutor.execute(
            f"""SELECT region AS region, centroid_lat AS lat, centroid_lon AS lon,
                medical_desert_score, mds_label, total_facilities, total_doctors, total_beds
            FROM {CATALOG}.gold_medical_desert_scores
            WHERE centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL""",
            max_rows=50,
        )
        await CacheService.set(cache_key, rows, ttl=600)
        return rows

    @staticmethod
    async def get_specialty_gaps() -> list[dict]:
        cache_key = "specialty:gaps"
        cached = await CacheService.get(cache_key)
        if cached:
            return cached

        rows = await DatabricksQueryExecutor.execute(
            f"""SELECT region_normalised AS region, desert_label, critical_specialty_gap_count AS gap_count,
                missing_critical_specialties AS missing_specialties
            FROM {CATALOG}.gold_regional_summary
            WHERE critical_specialty_gap_count > 0
            ORDER BY critical_specialty_gap_count DESC""",
            max_rows=50,
        )
        for row in rows:
            row["missing_specialties"] = _parse_json_col(row.get("missing_specialties"))

        await CacheService.set(cache_key, rows, ttl=600)
        return rows

    # ── Anomalies ──────────────────────────────────────────────────────────────

    @staticmethod
    async def get_anomalies(
        risk_level: str = "",
        region: str = "",
        limit: int = 50,
        offset: int = 0,
        data_source_header: Optional[dict] = None,
    ) -> dict:
        cache_key = CacheService.build_key("anomalies", risk_level, region, limit, offset)
        cached = await CacheService.get(cache_key)
        if cached:
            if data_source_header is not None:
                data_source_header["source"] = "cache"
            return cached

        where: list[str] = []
        params: list = []

        if risk_level:
            where.append("anomaly_risk_level = ?")
            params.append(risk_level)
        if region:
            where.append("region_normalised = ?")
            params.append(region)

        # Only show flagged facilities
        where.append("anomaly_risk_level != 'CLEAN'")

        where_clause = f"WHERE {' AND '.join(where)}"

        count_rows = await DatabricksQueryExecutor.execute(
            f"SELECT COUNT(*) AS total FROM {CATALOG}.gold_anomaly_flags {where_clause}",
            params, max_rows=1,
        )
        total = count_rows[0]["total"] if count_rows else 0

        rows = await DatabricksQueryExecutor.execute(
            f"""SELECT unique_id, name, city_clean, region_normalised,
                facility_type_clean, facility_tier_label, service_maturity_label,
                organization_type_clean, latitude, longitude,
                number_doctors_int, capacity_int,
                data_completeness_score, capability_confidence, capability_is_valid,
                has_emergency_medicine, has_surgery, has_icu,
                has_obstetrics, has_radiology, has_infectious_disease,
                has_mental_health, has_pediatrics,
                procedure_count, equipment_count, capability_count, specialty_count,
                -- Core anomaly scoring
                total_anomaly_flags, composite_anomaly_score, anomaly_risk_level,
                -- Ghost & data poverty
                ghost_probability_score, ghost_review_priority, data_poverty_flag,
                -- Risk dimensions
                quality_risk_score, clinical_risk_score, operational_risk_score, integrity_risk_score,
                -- Continuity
                continuity_risk_score, continuity_risk_flags, high_continuity_risk,
                -- Readiness
                emergency_readiness_score, critical_care_score,
                service_richness_score, infrastructure_completeness_score,
                referral_complexity_score, healthcare_maturity_score,
                -- Peer analysis
                peer_capability_zscore, peer_outlier_high_cap, peer_outlier_low_equip,
                quality_flag_taxonomy,
                -- Stat anomaly flags
                stat_anomaly_capability_inflation, stat_anomaly_hospital_no_doctors,
                stat_anomaly_clinic_claims_icu, stat_anomaly_ghost_facility,
                stat_anomaly_specialty_mismatch, stat_anomaly_procedure_breadth,
                -- Enhanced ML flags (all confirmed in CSV)
                enhanced_type_capability_mismatch, enhanced_ghost_hospital,
                enhanced_procedures_no_equipment, enhanced_low_idp_confidence,
                enhanced_suspicious_completeness, enhanced_icu_no_infrastructure,
                enhanced_implausible_doctor_bed_ratio, enhanced_em_without_surgical_support,
                enhanced_geo_contradiction, enhanced_planning_overconfidence,
                enhanced_graph_dependency_gap, enhanced_richness_equipment_mismatch,
                enhanced_maturity_infra_mismatch, enhanced_high_quality_risk,
                enhanced_peer_capability_outlier,
                -- LLM outputs
                llm_priority_action, llm_data_quality_score,
                llm_confirmed_anomaly_count, llm_anomaly_severity,
                llm_clinical_assessment, llm_false_positive_reason,
                llm_recommended_quality_category,
                -- Enriched lists
                specialties_enriched, procedure_enriched,
                equipment_enriched, capability_enriched, capability_anomalies,
                medical_desert_score, desert_label
            FROM {CATALOG}.gold_anomaly_flags
            {where_clause}
            ORDER BY total_anomaly_flags DESC NULLS LAST, composite_anomaly_score DESC NULLS LAST
            LIMIT {limit} OFFSET {offset}""",
            params, max_rows=limit,
        )
        for row in rows:
            for col in ["specialties_enriched", "capability_enriched", "procedure_enriched",
                        "equipment_enriched", "capability_anomalies", "continuity_risk_flags"]:
                row[col] = _parse_json_col(row.get(col))

        result = {"total": total, "items": rows}
        await CacheService.set(cache_key, result, ttl=300)
        if data_source_header is not None:
            data_source_header["source"] = "databricks"
        return result

    @staticmethod
    async def get_anomaly_summary(data_source_header: Optional[dict] = None) -> dict:  # noqa: E501
        cache_key = "anomalies:summary"
        cached = await CacheService.get(cache_key)
        if cached:
            if data_source_header is not None:
                data_source_header["source"] = "cache"
            return cached

        import asyncio
        results = await asyncio.gather(
            DatabricksQueryExecutor.execute(
                f"SELECT anomaly_risk_level, COUNT(*) AS cnt FROM {CATALOG}.gold_anomaly_flags GROUP BY anomaly_risk_level"
            ),
            DatabricksQueryExecutor.execute(
                f"""SELECT
                    SUM(CASE WHEN stat_anomaly_capability_inflation THEN 1 ELSE 0 END) AS capability_inflation,
                    SUM(CASE WHEN stat_anomaly_hospital_no_doctors THEN 1 ELSE 0 END) AS hospital_no_doctors,
                    SUM(CASE WHEN stat_anomaly_clinic_claims_icu THEN 1 ELSE 0 END) AS clinic_claims_icu,
                    SUM(CASE WHEN stat_anomaly_ghost_facility THEN 1 ELSE 0 END) AS ghost_facility,
                    SUM(CASE WHEN stat_anomaly_procedure_breadth THEN 1 ELSE 0 END) AS procedure_breadth,
                    SUM(CASE WHEN stat_anomaly_specialty_mismatch THEN 1 ELSE 0 END) AS specialty_mismatch,
                    SUM(CASE WHEN enhanced_type_capability_mismatch THEN 1 ELSE 0 END) AS enhanced_type_capability_mismatch,
                    SUM(CASE WHEN enhanced_ghost_hospital THEN 1 ELSE 0 END) AS enhanced_ghost_hospital,
                    SUM(CASE WHEN enhanced_procedures_no_equipment THEN 1 ELSE 0 END) AS enhanced_procedures_no_equipment,
                    SUM(CASE WHEN enhanced_low_idp_confidence THEN 1 ELSE 0 END) AS enhanced_low_idp_confidence,
                    SUM(CASE WHEN enhanced_suspicious_completeness THEN 1 ELSE 0 END) AS enhanced_suspicious_completeness,
                    SUM(CASE WHEN enhanced_icu_no_infrastructure THEN 1 ELSE 0 END) AS enhanced_icu_no_infrastructure,
                    SUM(CASE WHEN enhanced_implausible_doctor_bed_ratio THEN 1 ELSE 0 END) AS enhanced_implausible_doctor_bed_ratio,
                    SUM(CASE WHEN enhanced_em_without_surgical_support THEN 1 ELSE 0 END) AS enhanced_em_without_surgical_support,
                    SUM(CASE WHEN enhanced_high_quality_risk THEN 1 ELSE 0 END) AS enhanced_high_quality_risk,
                    SUM(CASE WHEN enhanced_peer_capability_outlier THEN 1 ELSE 0 END) AS enhanced_peer_capability_outlier,
                    SUM(CASE WHEN enhanced_maturity_infra_mismatch THEN 1 ELSE 0 END) AS enhanced_maturity_infra_mismatch,
                    SUM(CASE WHEN enhanced_graph_dependency_gap THEN 1 ELSE 0 END) AS enhanced_graph_dependency_gap,
                    SUM(CASE WHEN enhanced_richness_equipment_mismatch THEN 1 ELSE 0 END) AS enhanced_richness_equipment_mismatch,
                    SUM(CASE WHEN data_poverty_flag THEN 1 ELSE 0 END) AS data_poverty_count,
                    SUM(CASE WHEN high_continuity_risk THEN 1 ELSE 0 END) AS high_continuity_risk_count,
                    ROUND(AVG(composite_anomaly_score), 4) AS avg_composite_score,
                    ROUND(AVG(ghost_probability_score), 4) AS avg_ghost_probability,
                    ROUND(AVG(clinical_risk_score), 4) AS avg_clinical_risk,
                    ROUND(AVG(quality_risk_score), 4) AS avg_quality_risk,
                    ROUND(AVG(emergency_readiness_score), 4) AS avg_emergency_readiness,
                    ROUND(AVG(healthcare_maturity_score), 4) AS avg_healthcare_maturity
                FROM {CATALOG}.gold_anomaly_flags"""
            ),
            DatabricksQueryExecutor.execute(
                f"""SELECT region_normalised, COUNT(*) AS cnt
                FROM {CATALOG}.gold_anomaly_flags
                WHERE anomaly_risk_level IN ('CRITICAL', 'HIGH')
                GROUP BY region_normalised
                ORDER BY cnt DESC
                LIMIT 10"""
            ),
            DatabricksQueryExecutor.execute(
                f"""SELECT anomaly_risk_level,
                    ROUND(AVG(composite_anomaly_score), 4) AS avg_score,
                    ROUND(AVG(ghost_probability_score), 4) AS avg_ghost,
                    COUNT(*) AS cnt
                FROM {CATALOG}.gold_anomaly_flags
                WHERE anomaly_risk_level != 'CLEAN'
                GROUP BY anomaly_risk_level
                ORDER BY avg_score DESC"""
            ),
        )

        by_risk = {r["anomaly_risk_level"]: r["cnt"] for r in results[0]}
        type_counts = results[1][0] if results[1] else {}
        worst_regions = {r["region_normalised"]: r["cnt"] for r in results[2]}
        risk_stats = {r["anomaly_risk_level"]: {
            "avg_score": r["avg_score"],
            "avg_ghost": r["avg_ghost"],
            "count": r["cnt"],
        } for r in results[3]}

        summary = {
            "by_risk_level": by_risk,
            "anomaly_type_counts": type_counts,
            "worst_regions": worst_regions,
            "risk_stats": risk_stats,
            "global_stats": {
                "avg_composite_score": type_counts.get("avg_composite_score"),
                "avg_ghost_probability": type_counts.get("avg_ghost_probability"),
                "avg_clinical_risk": type_counts.get("avg_clinical_risk"),
                "avg_quality_risk": type_counts.get("avg_quality_risk"),
                "avg_emergency_readiness": type_counts.get("avg_emergency_readiness"),
                "avg_healthcare_maturity": type_counts.get("avg_healthcare_maturity"),
                "data_poverty_count": type_counts.get("data_poverty_count", 0),
                "high_continuity_risk_count": type_counts.get("high_continuity_risk_count", 0),
            },
        }
        await CacheService.set(cache_key, summary, ttl=600)
        if data_source_header is not None:
            data_source_header["source"] = "databricks"
        return summary

    @staticmethod
    async def get_regional_priority(data_source_header: Optional[dict] = None) -> list[dict]:
        """Fetch gold_regional_priority — ranked regions for NGO intervention."""
        cache_key = "regional:priority"
        cached = await CacheService.get(cache_key)
        if cached:
            if data_source_header is not None:
                data_source_header["source"] = "cache"
            return cached

        rows = await DatabricksQueryExecutor.execute(
            f"""SELECT
                region_normalised, facility_count,
                avg_desert_score, avg_emergency_gap, avg_continuity_fragility,
                avg_anomaly_density, avg_ghost_density,
                avg_low_infra_density, avg_low_staff_density,
                avg_low_equipment_density, avg_low_maturity_density,
                critical_facility_count, high_risk_facility_count, high_continuity_risk_count,
                avg_emergency_readiness, avg_data_completeness,
                regional_priority_score, priority_tier, recommended_interventions
            FROM {CATALOG}.gold_regional_priority
            ORDER BY regional_priority_score DESC NULLS LAST""",
            max_rows=20,
        )
        for row in rows:
            row["recommended_interventions"] = _parse_json_col(row.get("recommended_interventions"))

        await CacheService.set(cache_key, rows, ttl=900)
        if data_source_header is not None:
            data_source_header["source"] = "databricks"
        return rows

    @staticmethod
    async def execute_agent_sql(sql: str) -> list[dict]:
        """Execute agent-generated SQL with security validation."""
        FORBIDDEN = ["DROP", "CREATE", "INSERT", "UPDATE", "DELETE",
                     "ALTER", "TRUNCATE", "EXEC", "EXECUTE", "GRANT", "REVOKE"]
        sql_upper = sql.upper()
        for word in FORBIDDEN:
            if word in sql_upper:
                raise ValueError(f"Forbidden SQL keyword: {word}")

        # Ensure LIMIT is present
        if "LIMIT" not in sql_upper:
            sql = sql.rstrip(";") + " LIMIT 50"

        return await DatabricksQueryExecutor.execute(sql, max_rows=100)

    @staticmethod
    def execute_agent_sql_sync(sql: str) -> list[dict]:
        """Synchronous version for LangGraph agent nodes running in threads."""
        FORBIDDEN = ["DROP", "CREATE", "INSERT", "UPDATE", "DELETE",
                     "ALTER", "TRUNCATE", "EXEC", "EXECUTE", "GRANT", "REVOKE"]
        sql_upper = sql.upper()
        for word in FORBIDDEN:
            if word in sql_upper:
                raise ValueError(f"Forbidden SQL keyword: {word}")

        if "LIMIT" not in sql_upper:
            sql = sql.rstrip(";") + " LIMIT 50"

        return DatabricksQueryExecutor.execute_sync(sql, max_rows=100)

    @staticmethod
    async def get_suggested_queries() -> list[str]:
        return [
            # Q1.x — Basic Lookups (Must Have)
            "How many hospitals have cardiology in Ghana?",
            "How many hospitals in Ashanti have surgical capabilities?",
            "What services does Korle Bu Teaching Hospital offer?",
            "Are there any clinics in Tamale that do obstetrics?",
            "Which region has the most hospitals in Ghana?",
            # Q2.x — Geospatial (Must Have)
            "Where is the nearest facility with obstetrics within 50km of Tamale?",
            "Where are the largest geographic cold spots with no ICU within 100km?",
            # Q3.x — Validation (Should Have)
            "Which facilities claiming ICU also list ventilators and cardiac monitors?",
            "What percent of cataract surgery facilities also list an operating microscope?",
            "What percent of facilities claiming advanced specialties have permanent vs visiting services?",
            # Q4.x — Anomaly Detection (Must Have)
            "Which facilities claim unrealistic numbers of procedures relative to their size?",
            "Which facilities have high breadth of procedures but minimal equipment?",
            "Which clinics claim ICU but have no documented equipment?",
            "Where do we see things that should not move together - large bed counts with minimal surgical equipment?",
            "What correlations exist between facility characteristics like specialty depth and equipment?",
            "How many ghost facilities were detected by the AI agent?",
            # Q5.x — Service Classification (Could Have)
            "Which procedures appear to be delivered via itinerant outreach rather than permanent services?",
            "Which facilities language suggests they refer patients rather than perform the procedure?",
            # Q6.x — Workforce (Should Have)
            "Where is the workforce for ophthalmology actually practicing in Ghana?",
            "How many facilities have evidence of visiting specialists vs permanent staff?",
            "What areas show evidence of surgical camps or temporary medical missions?",
            "Where do signals indicate services are tied to named individuals implying fragility?",
            # Q7.x — Resource Gaps (Must Have)
            "Which procedures depend on only 1 or 2 facilities in Ghana?",
            "Where is oversupply of low-complexity procedures vs scarcity of high-complexity ones?",
            "What areas have high practitioner numbers but insufficient equipment to practice?",
            # Q8.x — NGO (Must Have / Should Have)
            "Which regions have multiple NGOs providing overlapping services?",
            "Which NGOs and faith-based organizations serve rural Volta communities?",
            "Where are there gaps where no NGO organizations are working despite evident need?",
            # Planning
            "Create an action plan for deploying resources to the most underserved regions",
            "What are the top anomalies detected in Greater Accra?",
            # Q10.x — Benchmarking (Should Have)
            "Compare hospital density between Greater Accra and Upper West",
            "What is the medical desert score for Savannah region?",
            "Which regions fall into the sweet spot with some infrastructure that could benefit most from intervention?",
        ]

