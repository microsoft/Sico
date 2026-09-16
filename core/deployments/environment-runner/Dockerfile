FROM docker:28-cli

ARG PIP_INDEX_URL

RUN apk add --no-cache python3 py3-pip \
    && python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /app
COPY requirements.txt ./
RUN if [ -n "$PIP_INDEX_URL" ]; then pip install --index-url "$PIP_INDEX_URL" --no-cache-dir -r requirements.txt; \
    else pip install --no-cache-dir -r requirements.txt; fi
COPY app.py ./

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
