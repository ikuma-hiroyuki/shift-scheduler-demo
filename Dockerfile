FROM python:3.13-slim AS base

WORKDIR /app

RUN pip install uv

COPY pyproject.toml .
COPY alembic.ini .
RUN uv pip install --system --no-cache -e .

COPY app/ app/

FROM base AS dev
RUN uv pip install --system --no-cache pytest pytest-asyncio httpx

FROM base AS prod
COPY render-start.sh /app/render-start.sh
RUN chmod +x /app/render-start.sh
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
