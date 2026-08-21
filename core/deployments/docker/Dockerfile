FROM python:3.13-slim
LABEL org.opencontainers.image.licenses="MIT"
ARG PYPI_INDEX_URL

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN test -n "${PYPI_INDEX_URL}" \
    && apt-get update \
    && apt-get install -y --no-install-recommends adb curl ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir --index-url "${PYPI_INDEX_URL}" uv

WORKDIR /app

COPY core/pyproject.toml core/uv.lock ./

ENV VIRTUAL_ENV=/opt/venv PATH="/opt/venv/bin:$PATH" UV_PROJECT_ENVIRONMENT="/opt/venv"
# uv.lock records registry URLs, so rewrite only the image-local copy before
# frozen sync when deployment tooling selects a different default index.
RUN uv venv "$VIRTUAL_ENV" \
    && uv lock --default-index "${PYPI_INDEX_URL}" \
    && uv sync --frozen --no-install-project --default-index "${PYPI_INDEX_URL}"

# Keep runtime configuration changes from invalidating the dependency layer.
COPY deploy/config ./config

COPY core/app ./app
RUN mkdir -p /mnt/storage

EXPOSE 50053
CMD ["python", "-m", "app.main"]
