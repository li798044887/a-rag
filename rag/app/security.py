from fastapi import Header, HTTPException

from app.config import settings


def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    if x_internal_token != settings.rag_internal_token:
        raise HTTPException(status_code=401, detail="invalid internal token")
