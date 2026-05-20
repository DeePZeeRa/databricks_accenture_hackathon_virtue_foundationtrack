"""FAISS index manager with three-strategy loading — FAISS is optional."""
from __future__ import annotations

import json
import os
import tempfile
from typing import Any, Optional

import structlog

logger = structlog.get_logger(__name__)

EMBEDDING_DIM = 1024

# Check if faiss is available (not yet available on Python 3.14)
try:
    import faiss as _faiss  # type: ignore
    FAISS_AVAILABLE = True
except ImportError:
    _faiss = None  # type: ignore
    FAISS_AVAILABLE = False
    logger.warning("faiss_not_installed", hint="pip install faiss-cpu (requires Python <=3.12)")

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore


class FAISSIndexManager:
    _index: Any = None
    _metadata: list[dict] = []
    _documents: list[str] = []
    _loaded: bool = False
    _load_strategy: str = "none"

    # Ghana regions for implicit filter extraction
    REGIONS = [
        "Greater Accra", "Ashanti", "Western", "Eastern", "Central",
        "Volta", "Northern", "Upper East", "Upper West", "Brong-Ahafo",
        "Oti", "Bono", "Bono East", "Ahafo", "Western North", "Savannah",
        "North East",
    ]

    SPECIALTY_KEYWORDS = {
        "surgery": "has_surgery",
        "surgical": "has_surgery",
        "emergency": "has_emergency_medicine",
        "icu": "has_icu",
        "intensive care": "has_icu",
        "obstetrics": "has_obstetrics",
        "maternity": "has_obstetrics",
        "pediatrics": "has_pediatrics",
        "children": "has_pediatrics",
        "radiology": "has_radiology",
        "imaging": "has_radiology",
        "infectious disease": "has_infectious_disease",
        "mental health": "has_mental_health",
        "psychiatry": "has_mental_health",
    }

    @classmethod
    def initialize(cls) -> None:
        """Load FAISS index using three strategies in priority order."""
        from app.core.config import settings

        if not FAISS_AVAILABLE:
            logger.warning("faiss_skip_init", reason="faiss not installed")
            cls._load_strategy = "disabled"
            return

        # Strategy 1: Local file paths
        if cls._try_load_local(settings.faiss_index_path, settings.faiss_meta_path):
            cls._load_strategy = "local"
            return

        # Strategy 2: Download from URL
        if settings.faiss_index_url and settings.faiss_meta_url:
            if cls._try_load_remote(settings.faiss_index_url, settings.faiss_meta_url):
                cls._load_strategy = "remote"
                return

        # Strategy 3: No-op fallback
        logger.warning("faiss_fallback_mode", reason="no_index_available")
        cls._loaded = False
        cls._load_strategy = "disabled"

    @classmethod
    def _try_load_local(cls, index_path: str, meta_path: str) -> bool:
        """Try loading from local filesystem."""
        if not FAISS_AVAILABLE:
            return False
        if not (os.path.exists(index_path) and os.path.exists(meta_path)):
            return False
        try:
            cls._index = _faiss.read_index(index_path)
            with open(meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            cls._metadata = data if isinstance(data, list) else data.get("metadata", [])
            cls._documents = [m.get("doc_text", "") for m in cls._metadata]
            cls._loaded = True
            logger.info(
                "faiss_loaded_local",
                vectors=cls._index.ntotal,
                meta_count=len(cls._metadata),
                index_path=index_path,
            )
            return True
        except Exception as e:
            logger.error("faiss_load_local_failed", error=str(e))
            return False

    @classmethod
    def _try_load_remote(cls, index_url: str, meta_url: str) -> bool:
        """Download FAISS files from remote URL and load."""
        if not FAISS_AVAILABLE:
            return False
        try:
            import httpx

            tmpdir = tempfile.mkdtemp(prefix="faiss_")
            idx_path = os.path.join(tmpdir, "faiss_index.bin")
            meta_path = os.path.join(tmpdir, "faiss_metadata.json")

            with httpx.Client(timeout=120) as client:
                logger.info("faiss_downloading_index", url=index_url)
                r = client.get(index_url)
                r.raise_for_status()
                with open(idx_path, "wb") as f:
                    f.write(r.content)

                logger.info("faiss_downloading_meta", url=meta_url)
                r = client.get(meta_url)
                r.raise_for_status()
                with open(meta_path, "wb") as f:
                    f.write(r.content)

            return cls._try_load_local(idx_path, meta_path)
        except Exception as e:
            logger.error("faiss_load_remote_failed", error=str(e))
            return False

    @classmethod
    def embed_query(cls, query: str) -> Optional[Any]:
        """Get BGE embedding for a query string."""
        if np is None or not FAISS_AVAILABLE:
            return None

        from app.core.config import settings

        if not settings.has_embed_endpoint:
            # Return random unit vector as fallback (semantic search disabled)
            logger.warning("embed_fallback_random", reason="no_embed_endpoint")
            vec = np.random.randn(1, EMBEDDING_DIM).astype(np.float32)
            _faiss.normalize_L2(vec)
            return vec

        try:
            import httpx

            headers = {
                "Authorization": f"Bearer {settings.databricks_token}",
                "Content-Type": "application/json",
            }

            # Try OpenAI-compatible format first (databricks-bge-large-en uses this)
            payload = {"input": [query]}
            with httpx.Client(timeout=30) as client:
                resp = client.post(settings.embed_endpoint, json=payload, headers=headers)

                if resp.status_code == 400:
                    # Fallback: MLflow dataframe_records format (older endpoints)
                    logger.debug("embed_openai_format_failed", status=resp.status_code,
                                 hint="Trying MLflow dataframe_records format")
                    payload2 = {"dataframe_records": [{"input": query}]}
                    resp = client.post(settings.embed_endpoint, json=payload2, headers=headers)
                    if resp.status_code == 400:
                        # Last try: old "text" field name
                        payload3 = {"dataframe_records": [{"text": query}]}
                        resp = client.post(settings.embed_endpoint, json=payload3, headers=headers)

                resp.raise_for_status()
                data = resp.json()

            # Handle OpenAI format: {"data": [{"embedding": [...]}]}
            if "data" in data and isinstance(data["data"], list):
                embedding = data["data"][0].get("embedding", [])
            else:
                # Handle MLflow format: {"predictions": [...]} or {"outputs": [...]}
                predictions = data.get("predictions", data.get("outputs", []))
                if isinstance(predictions, list) and len(predictions) > 0:
                    embedding = predictions[0]
                    if isinstance(embedding, dict):
                        embedding = embedding.get("embedding", list(embedding.values())[0])
                else:
                    embedding = predictions

            vec = np.array(embedding, dtype=np.float32).reshape(1, -1)
            _faiss.normalize_L2(vec)
            return vec
        except Exception as e:
            logger.error("embed_query_failed", error=str(e), query=query[:100])
            return None


    @classmethod
    def _normalize_meta(cls, meta: dict) -> dict:
        """Normalize metadata to use consistent keys regardless of schema version.
        New schema uses 'region', 'city', 'doctors', 'capacity';
        old schema used 'region_normalised', 'city_clean', 'number_doctors_int', 'capacity_int'.
        We keep BOTH so any code referencing either key still works.
        """
        out = dict(meta)
        # region
        if "region" in meta and "region_normalised" not in meta:
            out["region_normalised"] = meta["region"]
        if "region_normalised" in meta and "region" not in meta:
            out["region"] = meta["region_normalised"]
        # city
        if "city" in meta and "city_clean" not in meta:
            out["city_clean"] = meta["city"]
        if "city_clean" in meta and "city" not in meta:
            out["city"] = meta["city_clean"]
        # doctors
        if "doctors" in meta and "number_doctors_int" not in meta:
            out["number_doctors_int"] = meta["doctors"]
        if "number_doctors_int" in meta and "doctors" not in meta:
            out["doctors"] = meta["number_doctors_int"]
        # capacity
        if "capacity" in meta and "capacity_int" not in meta:
            out["capacity_int"] = meta["capacity"]
        if "capacity_int" in meta and "capacity" not in meta:
            out["capacity"] = meta["capacity_int"]
        # specialties
        if "specialties" in meta and "specialties_enriched" not in meta:
            out["specialties_enriched"] = meta["specialties"]
        if "procedures" in meta and "procedure_enriched" not in meta:
            out["procedure_enriched"] = meta["procedures"]
        if "equipment" in meta and "equipment_enriched" not in meta:
            out["equipment_enriched"] = meta["equipment"]
        # facility_type_clean
        if "facility_type" in meta and "facility_type_clean" not in meta:
            out["facility_type_clean"] = meta["facility_type"]
        # volunteers
        if "accepts_volunteers" in meta and "accepts_volunteers_bool" not in meta:
            out["accepts_volunteers_bool"] = meta["accepts_volunteers"]
        return out

    @classmethod
    def search(
        cls,
        query: str,
        k: int = 8,
        filter_region: Optional[str] = None,
        filter_type: Optional[str] = None,
        filter_specialty: Optional[str] = None,
        filter_volunteer: Optional[bool] = None,
        filter_desert: Optional[str] = None,
        min_completeness: Optional[float] = None,
    ) -> list[dict]:
        """Semantic search with post-filtering."""
        if not cls._loaded or cls._index is None or not FAISS_AVAILABLE:
            return []

        # Auto-detect filters from query if not explicitly provided
        implicit = cls._extract_implicit_filters(query)
        filter_region = filter_region or implicit.get("region")
        filter_type = filter_type or implicit.get("type")
        filter_specialty = filter_specialty or implicit.get("specialty")

        vec = cls.embed_query(query)
        if vec is None:
            return []

        candidates = min(k * 12, cls._index.ntotal)
        scores, indices = cls._index.search(vec, candidates)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(cls._metadata):
                continue
            raw_meta = cls._metadata[idx]
            meta = cls._normalize_meta(raw_meta)  # normalize key names
            doc = cls._documents[idx] if idx < len(cls._documents) else ""

            # Apply filters — check both old and new key names for region/type
            if filter_region:
                region_val = str(meta.get("region_normalised", meta.get("region", ""))).lower()
                if filter_region.lower() not in region_val:
                    continue
            if filter_type:
                type_val = str(meta.get("facility_type_clean", meta.get("facility_type", ""))).lower()
                if filter_type.lower() not in type_val:
                    continue
            if filter_specialty:
                spec_key = f"has_{filter_specialty.lower().replace(' ', '_')}"
                if not meta.get(spec_key, False):
                    continue
            if filter_volunteer is True:
                vol = meta.get("accepts_volunteers_bool", meta.get("accepts_volunteers", False))
                if not vol:
                    continue
            if filter_desert and filter_desert.lower() not in str(meta.get("desert_label", "")).lower():
                continue
            if min_completeness and (meta.get("data_completeness_score", 0) or 0) < min_completeness:
                continue

            results.append({
                "score": float(score),
                "document": doc,
                "metadata": meta,
                "citations": meta.get("idp_citations", []),
                "facility_name": meta.get("name", ""),
                "region": meta.get("region_normalised", meta.get("region", "")),
                "unique_id": meta.get("unique_id", ""),
            })

            if len(results) >= k:
                break

        return results

    @classmethod
    def _extract_implicit_filters(cls, query: str) -> dict:
        """Extract implicit filters from natural language query."""
        query_lower = query.lower()
        filters: dict = {}

        for region in cls.REGIONS:
            if region.lower() in query_lower:
                filters["region"] = region
                break

        for kw, _spec in cls.SPECIALTY_KEYWORDS.items():
            if kw in query_lower:
                filters["specialty"] = kw
                break

        for ftype in ["hospital", "clinic", "ngo", "pharmacy"]:
            if ftype in query_lower:
                filters["type"] = ftype.capitalize()
                break

        return filters
