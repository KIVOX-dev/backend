# Python/FastAPI service image. Build context is this directory (python-service/):
#   docker build -t skillovate-python-service -f python-service/Dockerfile python-service/

# ---- builder: install deps into a venv; build toolchain never reaches runtime ----
FROM python:3.12-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---- runtime: slim final image — venv + app source only, non-root ----
FROM python:3.12-slim AS runtime
WORKDIR /app

RUN useradd --create-home --uid 1001 appuser

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# .dockerignore excludes .env, .venv, uploads/, __pycache__ — see that file
# for the full list; none of those should ever reach an image layer.
COPY --chown=appuser:appuser . .
RUN mkdir -p uploads/profile && chown -R appuser:appuser uploads

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/health', timeout=3)"

# No --reload: that's a dev-only flag (single worker, file-watcher overhead).
# PORT and WEB_CONCURRENCY are both overridable at deploy time (Cloud Run sets $PORT).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-2}"]
