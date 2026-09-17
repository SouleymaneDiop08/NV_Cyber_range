# Station B 3D Viewer - Dockerfile
# Minimal deployment package for OT_RANGE_V2

FROM python:3.11-slim

RUN useradd -m -s /bin/bash viewer && \
    mkdir -p /app/static && \
    chown -R viewer:viewer /app

WORKDIR /app

COPY --chown=viewer:viewer backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=viewer:viewer backend/*.py /app/
COPY --chown=viewer:viewer frontend/static/ /app/static/

RUN chmod 0644 /app/*.py /app/requirements.txt && \
    find /app/static -type f -exec chmod 0644 {} + && \
    find /app/static -type d -exec chmod 0755 {} +

USER viewer

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8090/api/status')" || exit 1

CMD ["python", "telemetry_server.py", "--host", "0.0.0.0", "--port", "8090", "--static", "/app/static"]
