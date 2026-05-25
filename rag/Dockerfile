FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
ENV PATH="/app/.venv/bin:$PATH"
RUN uv sync --no-dev --frozen
COPY app ./app
# COPY alembic ./alembic
# COPY alembic.ini ./alembic.ini
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
