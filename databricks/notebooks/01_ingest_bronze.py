# Databricks notebook source
from pyspark.sql import functions as F

CATALOG = "vf_health"
SCHEMA = "ghana"
BRONZE = f"{CATALOG}.{SCHEMA}.bronze_raw_facilities"

INPUT_PATH = "/Volumes/vf_health/ghana/raw/Virtue Foundation Ghana v0.3 - Sheet1.csv"

# 1) Read raw CSV (supports multiline + escaped quotes)
df = (
    spark.read
    .option("header", True)
    .option("multiLine", True)
    .option("quote", '"')
    .option("escape", '"')
    .option("mode", "PERMISSIVE")
    .csv(INPUT_PATH)
)

# 2) Remove fully-empty rows (your file has many trailing comma-only lines)
non_empty_cond = None
for c in df.columns:
    cond = F.col(c).isNotNull() & (F.trim(F.col(c)) != "")
    non_empty_cond = cond if non_empty_cond is None else (non_empty_cond | cond)

df = df.filter(non_empty_cond)

# 3) Add ingestion timestamp
df = df.withColumn("ingested_at", F.current_timestamp())

# 4) Write to bronze
df.write.mode("overwrite").format("delta").saveAsTable(BRONZE)

print("Bronze rows:", spark.table(BRONZE).count())
display(spark.table(BRONZE).limit(20))