FROM python:3.11-slim

WORKDIR /app

# Node powers server-side grading of the JavaScript code labs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# psycopg2-binary and cryptography ship manylinux wheels — no build toolchain needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN sed -i 's/\r$//' /app/scripts/entrypoint.sh && chmod +x /app/scripts/entrypoint.sh

EXPOSE 8000

# The entrypoint logs a dependency report, applies migrations (RUN_DB_MIGRATIONS_ON_START),
# optionally seeds (AUTO_SEED=1), then runs the command. It stays in place when a
# deployment overrides the command (set `args` in Kubernetes, not `command`).
# docker-compose adds --reload for local work; the image does not.
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
