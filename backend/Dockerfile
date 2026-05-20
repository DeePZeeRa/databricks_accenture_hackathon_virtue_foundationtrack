FROM python:3.11.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create RAG data directory and attempt to download FAISS files at build time
RUN mkdir -p /app/rag_data

ARG FAISS_INDEX_URL=""
ARG FAISS_META_URL=""

RUN if [ -n "$FAISS_INDEX_URL" ]; then \
    wget -q -O /app/rag_data/faiss_index.bin "$FAISS_INDEX_URL" && \
    echo "FAISS index downloaded at build time"; \
    fi

RUN if [ -n "$FAISS_META_URL" ]; then \
    wget -q -O /app/rag_data/faiss_metadata.json "$FAISS_META_URL" && \
    echo "FAISS metadata downloaded at build time"; \
    fi

EXPOSE 8000

ENV FAISS_INDEX_PATH=/app/rag_data/faiss_index.bin
ENV FAISS_META_PATH=/app/rag_data/faiss_metadata.json

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-keep-alive", "120"]
