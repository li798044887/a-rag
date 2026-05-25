# フェーズ1: インフラ足場

> 前提・共通規約は [README.md](./README.md) を参照。コミットは Conventional Commits（日本語説明）。

**このフェーズのゴール:** `docker compose up` で Postgres / Qdrant / Redis が起動し、`rag` サービスが `/health` を返し、`web` が Postgres に接続できる状態。後続フェーズの土台。

**依存:** なし

**作成/変更するファイル:**
- Create: `docker-compose.yml`, `docker-compose.gpu.yml`
- Create: `rag/pyproject.toml`, `rag/app/__init__.py`, `rag/app/config.py`, `rag/app/main.py`, `rag/Dockerfile`, `rag/.dockerignore`
- Create: `rag/tests/__init__.py`, `rag/tests/test_health.py`
- Create: `src/lib/db/index.ts`, `src/lib/db/schema.ts`, `drizzle.config.ts`
- Create: `vitest.config.ts`, `src/lib/db/db.test.ts`
- Modify: `package.json`（test スクリプト + 依存）, `.env.example`, `.gitignore`

---

### Task 1: docker compose（postgres / qdrant / redis）

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: compose を作成**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: arag
      POSTGRES_PASSWORD: arag
      POSTGRES_DB: arag
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U arag"]
      interval: 5s
      timeout: 3s
      retries: 10

  qdrant:
    image: qdrant/qdrant:v1.12.4
    ports: ["6333:6333", "6334:6334"]
    volumes: ["qdrantdata:/qdrant/storage"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: ["redisdata:/data"]

volumes:
  pgdata:
  qdrantdata:
  redisdata:
```

- [ ] **Step 2: 構文検証**

Run: `docker compose config -q && echo OK`
Expected: `OK`（エラー出力なし）

- [ ] **Step 3: 起動確認**

Run: `docker compose up -d postgres qdrant redis && sleep 5 && docker compose ps`
Expected: 3 サービスが `running`、postgres は `healthy`

- [ ] **Step 4: コミット**

```bash
git add docker-compose.yml
git commit -m "feat: postgres/qdrant/redis の docker compose を追加"
```

---

### Task 2: rag サービス雛形（FastAPI + 設定）

**Files:**
- Create: `rag/pyproject.toml`, `rag/app/__init__.py`, `rag/app/config.py`, `rag/app/main.py`

- [ ] **Step 1: pyproject を作成**

`rag/pyproject.toml`:
```toml
[project]
name = "arag-rag"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "pydantic-settings>=2.6",
  "httpx>=0.27",
]

[dependency-groups]
dev = ["pytest>=8.3", "pytest-asyncio>=0.24"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
pythonpath = ["."]
```

- [ ] **Step 2: 依存をインストール**

Run: `cd rag && uv sync --group dev`
Expected: `.venv` 作成、`Installed ... packages`

- [ ] **Step 3: 設定モジュールを作成**

`rag/app/__init__.py`: 空ファイル。

`rag/app/config.py`:
```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://arag:arag@localhost:5432/arag"
    qdrant_url: str = "http://localhost:6333"
    redis_url: str = "redis://localhost:6379"
    device: str = "cpu"
    embedder: str = "bge-m3"
    rag_internal_token: str = "dev-internal-token"


settings = Settings()
```

- [ ] **Step 4: FastAPI アプリを作成**

`rag/app/main.py`:
```python
from fastapi import FastAPI

app = FastAPI(title="ARag RAG service")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "models_loaded": False}
```

- [ ] **Step 5: コミット**

```bash
git add rag/pyproject.toml rag/uv.lock rag/app/__init__.py rag/app/config.py rag/app/main.py
git commit -m "feat: rag サービス（FastAPI）の雛形と設定を追加"
```

---

### Task 3: `/health` のテスト（TDD）

**Files:**
- Create: `rag/tests/__init__.py`, `rag/tests/test_health.py`

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/__init__.py`: 空ファイル。

`rag/tests/test_health.py`:
```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["models_loaded"] is False
```

- [ ] **Step 2: 失敗を確認**

Run: `cd rag && uv run pytest tests/test_health.py -v`
Expected: `httpx` 依存が無く ImportError、または `TestClient` 未解決で FAIL。

- [ ] **Step 3: テスト依存を追加して合格させる**

`rag/pyproject.toml` の dev グループに追記:
```toml
dev = ["pytest>=8.3", "pytest-asyncio>=0.24", "httpx>=0.27"]
```
Run: `cd rag && uv sync --group dev`

- [ ] **Step 4: 合格を確認**

Run: `cd rag && uv run pytest tests/test_health.py -v`
Expected: `1 passed`

- [ ] **Step 5: コミット**

```bash
git add rag/tests/__init__.py rag/tests/test_health.py rag/pyproject.toml rag/uv.lock
git commit -m "test: rag /health のテストを追加"
```

---

### Task 4: web のテスト基盤（vitest）

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: 依存と test スクリプトを追加**

Run:
```bash
pnpm add -D vitest @vitejs/plugin-react vite-tsconfig-paths
```
`package.json` の `scripts` に追加:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: vitest 設定を作成**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: スモークテストで疎通確認**

一時ファイル `src/lib/smoke.test.ts`:
```ts
import { expect, test } from "vitest";

test("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```
Run: `pnpm test`
Expected: `1 passed`。確認後 `rm src/lib/smoke.test.ts`。

- [ ] **Step 4: コミット**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "test: web に vitest を導入"
```

---

### Task 5: web の Postgres 接続（Drizzle）

**Files:**
- Create: `src/lib/db/index.ts`, `src/lib/db/schema.ts`, `drizzle.config.ts`
- Create: `src/lib/db/db.test.ts`
- Modify: `package.json`, `.env.example`

- [ ] **Step 1: 依存を追加**

Run: `pnpm add drizzle-orm pg && pnpm add -D drizzle-kit @types/pg`

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/db/db.test.ts`:
```ts
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// 要 `docker compose up -d postgres`
test("db connects to postgres", async () => {
  const res = await db.execute(sql`select 1 as one`);
  expect(res.rows[0]).toMatchObject({ one: 1 });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `pnpm test src/lib/db/db.test.ts`
Expected: `@/lib/db` が未作成で FAIL（Cannot find module）。

- [ ] **Step 4: 接続モジュールと空スキーマを実装**

`src/lib/db/schema.ts`:
```ts
// テーブル定義はフェーズ2以降で追加する。
export {};
```

`src/lib/db/index.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

const connectionString =
  process.env.DATABASE_URL || "postgres://arag:arag@localhost:5432/arag";

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
```

`drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://arag:arag@localhost:5432/arag",
  },
});
```

- [ ] **Step 5: 合格を確認**

Run: `docker compose up -d postgres && pnpm test src/lib/db/db.test.ts`
Expected: `1 passed`

- [ ] **Step 6: コミット**

```bash
git add src/lib/db package.json pnpm-lock.yaml drizzle.config.ts
git commit -m "feat: web に Drizzle + Postgres 接続層を追加"
```

---

### Task 6: rag コンテナ化と compose 統合、env 雛形

**Files:**
- Create: `rag/Dockerfile`, `rag/.dockerignore`, `docker-compose.gpu.yml`
- Modify: `docker-compose.yml`, `.env.example`, `.gitignore`

- [ ] **Step 1: rag Dockerfile**

`rag/Dockerfile`:
```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

> 注: `alembic/` と `alembic.ini` はフェーズ3で作成する。フェーズ1時点では COPY 行で失敗するため、**フェーズ3でこの2行を有効化**する（フェーズ1では該当2行をコメントアウトしておく）。

`rag/.dockerignore`:
```
.venv
__pycache__
*.pyc
tests
.env
```

- [ ] **Step 2: compose に rag(api) と worker を追加**

`docker-compose.yml` の `services:` に追記:
```yaml
  rag:
    build: ./rag
    environment:
      DATABASE_URL: postgresql+psycopg://arag:arag@postgres:5432/arag
      QDRANT_URL: http://qdrant:6333
      REDIS_URL: redis://redis:6379
      DEVICE: cpu
      EMBEDDER: bge-m3
      RAG_INTERNAL_TOKEN: dev-internal-token
    ports: ["8000:8000"]
    volumes: ["uploads:/data/uploads"]
    depends_on:
      postgres: { condition: service_healthy }
      qdrant: { condition: service_started }
      redis: { condition: service_started }

  rag-worker:
    build: ./rag
    command: ["arq", "app.worker.WorkerSettings"]
    environment:
      DATABASE_URL: postgresql+psycopg://arag:arag@postgres:5432/arag
      QDRANT_URL: http://qdrant:6333
      REDIS_URL: redis://redis:6379
      DEVICE: cpu
      EMBEDDER: bge-m3
      RAG_INTERNAL_TOKEN: dev-internal-token
    volumes: ["uploads:/data/uploads"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
```
`volumes:` に `uploads:` を追加。

> 注: `rag-worker` の `arq app.worker...` はフェーズ3で `app/worker.py` を作るまで起動しない。フェーズ1の検証では `rag-worker` は起動対象に含めない。

- [ ] **Step 3: GPU オーバーレイ**

`docker-compose.gpu.yml`:
```yaml
services:
  rag:
    environment:
      DEVICE: cuda
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
  rag-worker:
    environment:
      DEVICE: cuda
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```
GPU 起動は `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`。

- [ ] **Step 4: `.env.example` を更新**

`.env.example` に追記（既存の `ARAG_JWT_SECRET`/`ANTHROPIC_API_KEY` は残す）:
```bash
# web → Postgres
DATABASE_URL=postgres://arag:arag@localhost:5432/arag
# web → rag サービス
RAG_SERVICE_URL=http://localhost:8000
RAG_INTERNAL_TOKEN=dev-internal-token
```

- [ ] **Step 5: `.gitignore` に Python 成果物を追加**

`.gitignore` に追記:
```
# rag (python)
rag/.venv/
rag/__pycache__/
**/__pycache__/
*.pyc
.env
```

- [ ] **Step 6: ビルドと疎通確認**

Run:
```bash
docker compose build rag
docker compose up -d
sleep 8
curl -s localhost:8000/health
```
Expected: `{"status":"ok","models_loaded":false}`

- [ ] **Step 7: コミット**

```bash
git add rag/Dockerfile rag/.dockerignore docker-compose.yml docker-compose.gpu.yml .env.example .gitignore
git commit -m "feat: rag のコンテナ化と compose 統合、env 雛形を追加"
```

---

## フェーズ1 完了条件
- `docker compose up -d` で postgres(healthy)/qdrant/redis/rag が起動
- `curl localhost:8000/health` が ok
- `cd rag && uv run pytest` が green
- `pnpm test` が green（db 接続テスト含む、要 postgres 起動）
