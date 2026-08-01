# AI microservice image (FastAPI). Build context is this directory (ai-service/):
#   docker build -t upscaler-ai-service -f ai-service/Dockerfile ai-service/

FROM python:3.12-slim AS runtime
WORKDIR /app

# requirements-lock.txt is the exact resolved set (pip freeze) — mirrors
# node-api's package-lock.json discipline: reproducible installs, not
# whatever the >= ranges in requirements.txt happen to resolve to on the day
# of the build.
COPY requirements-lock.txt ./
RUN pip install --no-cache-dir -r requirements-lock.txt

COPY app ./app

RUN useradd --create-home --uid 1000 appuser
USER appuser

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health').read()" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
