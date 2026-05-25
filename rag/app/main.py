from fastapi import FastAPI

app = FastAPI(title="ARag RAG service")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "models_loaded": False}
