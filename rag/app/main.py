from fastapi import FastAPI

from app.routers import documents, jobs

app = FastAPI(title="ARag RAG service")
app.include_router(documents.router)
app.include_router(jobs.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "models_loaded": False}
