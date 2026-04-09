# Databricks notebook source
from pyspark.sql import functions as F, types as T

CATALOG = "vf_health"
SCHEMA = "ghana"
BRONZE = f"{CATALOG}.{SCHEMA}.bronze_raw_facilities"
SILVER = f"{CATALOG}.{SCHEMA}.silver_facilities_clean"

df = spark.table(BRONZE)

# helper to parse JSON-like arrays safely
def parse_array_str(colname: str):
    raw = F.coalesce(F.col(colname), F.lit("[]"))
    raw = F.when(F.lower(F.trim(raw)).isin("null", ""), F.lit("[]")).otherwise(raw)
    arr = F.from_json(raw, T.ArrayType(T.StringType()))
    return F.coalesce(arr, F.array().cast("array<string>"))

clean = (
    df
    .filter(F.col("name").isNotNull() & (F.trim(F.col("name")) != ""))
    .withColumn("name", F.trim("name"))
    .withColumn("organization_type", F.lower(F.trim("organization_type")))
    .withColumn("specialties", parse_array_str("specialties"))
    .withColumn("procedure", parse_array_str("procedure"))
    .withColumn("equipment", parse_array_str("equipment"))
    .withColumn("capability", parse_array_str("capability"))
    .withColumn("phone_numbers", parse_array_str("phone_numbers"))
    .withColumn("websites", parse_array_str("websites"))
    .withColumn("countries", parse_array_str("countries"))
    .withColumn("affiliationTypeIds", parse_array_str("affiliationTypeIds"))
    .withColumn("address_country", F.coalesce(F.col("address_country"), F.lit("Ghana")))
    .withColumn("address_countryCode", F.coalesce(F.col("address_countryCode"), F.lit("GH")))
    .withColumn("yearEstablished", F.col("yearEstablished").cast("int"))
    .withColumn("acceptsVolunteers",
                F.when(F.lower(F.col("acceptsVolunteers")) == "true", F.lit(True))
                 .when(F.lower(F.col("acceptsVolunteers")) == "false", F.lit(False))
                 .otherwise(F.lit(None).cast("boolean")))
    .withColumn("area", F.col("area").cast("int"))
    .withColumn("numberDoctors", F.col("numberDoctors").cast("int"))
    .withColumn("capacity", F.col("capacity").cast("int"))
    .withColumn("row_id", F.sha2(F.concat_ws("||", F.coalesce("unique_id", F.lit("")), F.coalesce("source_url", F.lit(""))), 256))
    .dropDuplicates(["unique_id", "source_url"])
    .withColumn("cleaned_at", F.current_timestamp())
)

silver_df = clean.select(
    "row_id",
    "unique_id",
    "source_url",
    "name",
    "organization_type",
    "specialties",
    "procedure",
    "equipment",
    "capability",
    "phone_numbers",
    "email",
    "websites",
    "officialWebsite",
    "yearEstablished",
    "acceptsVolunteers",
    "facebookLink",
    "twitterLink",
    "linkedinLink",
    "instagramLink",
    "logo",
    "address_line1",
    "address_line2",
    "address_line3",
    "address_city",
    "address_stateOrRegion",
    "address_zipOrPostcode",
    "address_country",
    "address_countryCode",
    "countries",
    "missionStatement",
    "missionStatementLink",
    "organizationDescription",
    "facilityTypeId",
    "operatorTypeId",
    "affiliationTypeIds",
    "description",
    "area",
    "numberDoctors",
    "capacity",
    "cleaned_at"
)

silver_df.write.mode("overwrite").format("delta").saveAsTable(SILVER)

print("Silver rows:", spark.table(SILVER).count())
display(spark.table(SILVER).limit(20))