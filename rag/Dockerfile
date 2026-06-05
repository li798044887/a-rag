FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
# build-essential/zlib1g-dev: MinerU 依存 zlib-state など C 拡張のビルドに必要。
# libgl1/libglib2.0-0/libxcb1 等: OpenCV・torchvision（MinerU pipeline）の実行時共有ライブラリ。
# libreoffice-{writer,calc,impress}: Office 原本のブラウザプレビュー用 PDF 変換（soffice --headless）。
#   フルパッケージは避け必要モジュールのみ。fonts-noto-cjk が無いと日本語が豆腐になるため必須。
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential zlib1g-dev \
        libgl1 libglib2.0-0 libxcb1 libsm6 libxext6 libxrender1 \
        libreoffice-writer libreoffice-calc libreoffice-impress \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
ENV PATH="/app/.venv/bin:$PATH"
RUN uv sync --no-dev --frozen
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY eval ./eval
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
