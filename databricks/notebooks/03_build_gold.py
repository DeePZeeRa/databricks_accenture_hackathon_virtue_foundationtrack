# Databricks notebook source
from pyspark.sql import functions as F

CATALOG = "vf_health"
SCHEMA = "ghana"

SILVER = f"{CATALOG}.{SCHEMA}.silver_facilities_clean"
GOLD_PROFILES = f"{CATALOG}.{SCHEMA}.gold_facility_profiles"
GOLD_CLAIMS = f"{CATALOG}.{SCHEMA}.gold_facility_claims"
GOLD_CITATIONS = f"{CATALOG}.{SCHEMA}.gold_citations"
GOLD_RISK = f"{CATALOG}.{SCHEMA}.gold_risk_signals"
GOLD_DESERTS = f"{CATALOG}.{SCHEMA}.gold_medical_deserts"

df = spark.table(SILVER)

# -------------------------
# 1) gold_facility_profiles
# -------------------------
profiles = (
    df.select("row_id", "unique_id", "name", "organization_type", *[c for c in df.columns if c not in ["row_id", "unique_id", "name", "organization_type"]])
      .withColumn("profile_json", F.to_json(F.struct(*[c for c in df.columns if c not in ["row_id", "unique_id", "name", "organization_type"]])))
      .select("row_id", "unique_id", "name", "organization_type", "profile_json")
      .withColumn("updated_at", F.current_timestamp())
)

profiles.write.mode("overwrite").format("delta").saveAsTable(GOLD_PROFILES)

# -------------------------
# 2) gold_facility_claims
# -------------------------
proc_claims = (
    df.select("row_id", "unique_id", F.explode_outer("procedure").alias("claim_text"))
      .filter(F.col("claim_text").isNotNull() & (F.trim("claim_text") != "") & (F.trim("claim_text") != '""'))
      .withColumn("claim_type", F.lit("procedure"))
)

equip_claims = (
    df.select("row_id", "unique_id", F.explode_outer("equipment").alias("claim_text"))
      .filter(F.col("claim_text").isNotNull() & (F.trim("claim_text") != "") & (F.trim("claim_text") != '""'))
      .withColumn("claim_type", F.lit("equipment"))
)

cap_claims = (
    df.select("row_id", "unique_id", F.explode_outer("capability").alias("claim_text"))
      .filter(F.col("claim_text").isNotNull() & (F.trim("claim_text") != "") & (F.trim("claim_text") != '""'))
      .withColumn("claim_type", F.lit("capability"))
)

claims = (
    proc_claims.unionByName(equip_claims).unionByName(cap_claims)
    .withColumn("confidence", F.lit(0.80).cast("double"))
    .withColumn("claim_id", F.sha2(F.concat_ws("||", "row_id", "claim_type", "claim_text"), 256))
    .withColumn("created_at", F.current_timestamp())
    .select("claim_id", "row_id", "unique_id", "claim_type", "claim_text", "confidence", "created_at")
)

claims.write.mode("overwrite").format("delta").saveAsTable(GOLD_CLAIMS)

# -------------------------
# 3) gold_citations (row-level)
# -------------------------
citations = (
    df.select("row_id", "source_url", "procedure", "equipment", "capability")
      .withColumn("evidence_text", F.concat_ws(" | ",
                                               F.array_join("procedure", "; "),
                                               F.array_join("equipment", "; "),
                                               F.array_join("capability", "; ")))
      .withColumn("field", F.lit("procedure/equipment/capability"))
      .withColumn("step_id", F.lit("gold_build_v1"))
      .withColumn("citation_id", F.sha2(F.concat_ws("||", "row_id", "source_url", "field"), 256))
      .withColumn("created_at", F.current_timestamp())
      .select("citation_id", "row_id", "source_url", "field", "evidence_text", "step_id", "created_at")
)

citations.write.mode("overwrite").format("delta").saveAsTable(GOLD_CITATIONS)

# -------------------------
# 4) gold_risk_signals (simple anomaly starter)
# -------------------------
risk = (
    df
    .withColumn("has_no_contact", (F.size("phone_numbers") == 0) & F.col("email").isNull() & (F.size("websites") == 0))
    .withColumn("bad_capacity", F.col("capacity").isNotNull() & (F.col("capacity") < 0))
    .withColumn("signal_flag", F.col("has_no_contact") | F.col("bad_capacity"))
    .withColumn("signal_type", F.when(F.col("bad_capacity"), F.lit("anomaly_capacity"))
                                .when(F.col("has_no_contact"), F.lit("missing_contact"))
                                .otherwise(F.lit("none")))
    .withColumn("signal_score", F.when(F.col("signal_flag"), F.lit(0.7)).otherwise(F.lit(0.0)))
    .withColumn("reason", F.when(F.col("bad_capacity"), F.lit("capacity < 0"))
                           .when(F.col("has_no_contact"), F.lit("no phone/email/website"))
                           .otherwise(F.lit("ok")))
    .withColumn("signal_id", F.sha2(F.concat_ws("||", "row_id", "signal_type", "reason"), 256))
    .withColumn("created_at", F.current_timestamp())
    .select("signal_id", "row_id", "unique_id", "signal_type", "signal_score", "signal_flag", "reason", "created_at")
)

risk.write.mode("overwrite").format("delta").saveAsTable(GOLD_RISK)

# -------------------------
# 5) gold_medical_deserts (region/district gap metric)
# -------------------------
# emergency_sites: capability mentions "emergency"
# maternal_sites: specialties mention gynecology/obstetrics OR capability mentions maternity
deserts = (
    df
    .withColumn("region", F.coalesce("address_stateOrRegion", F.lit("UNKNOWN")))
    .withColumn("district", F.coalesce("address_city", F.lit("UNKNOWN")))
    .withColumn("is_emergency",
                F.expr("exists(capability, x -> lower(x) like '%emergency%')"))
    .withColumn("is_maternal",
                F.expr("exists(specialties, x -> lower(x) like '%gynecology%' or lower(x) like '%obstetric%') "
                       "OR exists(capability, x -> lower(x) like '%maternity%')"))
    .groupBy("region", "district")
    .agg(
        F.count("*").alias("facility_count"),
        F.sum(F.when(F.col("is_emergency"), 1).otherwise(0)).alias("emergency_sites"),
        F.sum(F.when(F.col("is_maternal"), 1).otherwise(0)).alias("maternal_sites")
    )
    .withColumn(
        "desert_score",
        (F.lit(1.0)/(F.col("facility_count")+F.lit(1.0))) +
        (F.lit(1.0)/(F.col("emergency_sites")+F.lit(1.0))) +
        (F.lit(1.0)/(F.col("maternal_sites")+F.lit(1.0)))
    )
    .withColumn("computed_at", F.current_timestamp())
)

deserts.write.mode("overwrite").format("delta").saveAsTable(GOLD_DESERTS)

print("Gold profiles:", spark.table(GOLD_PROFILES).count())
print("Gold claims:", spark.table(GOLD_CLAIMS).count())
print("Gold citations:", spark.table(GOLD_CITATIONS).count())
print("Gold risk signals:", spark.table(GOLD_RISK).count())
print("Gold deserts:", spark.table(GOLD_DESERTS).count())

display(spark.table(GOLD_DESERTS).orderBy(F.col("desert_score").desc()).limit(20))