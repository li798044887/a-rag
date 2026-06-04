import hashlib
import uuid
from pathlib import Path

from arq import create_pool
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.documents_service import (
    assets_dir_for, cleanup_document_files, convert_to_pdf, find_layout_pdf,
    is_convertible, list_documents, find_span_pdf, record_workspace_activity,
    resolve_within, select_chunks, workspace_stats,
)
from app.models import Chunk, Content, Document, IngestJob
from app.queue import redis_settings
from app.vectorstore.qdrant import QdrantStore
from app.schemas import (
    BulkDeleteRequest, BulkDeleteResponse,
    DocumentListResponse, FetchDocumentRequest, FetchDocumentResponse, FetchedChunk, IngestStarted,
    WorkspaceStats,
)
from app.security import require_internal_token

router = APIRouter()


def _list_documents(owner_user_id: str, limit: int, cursor: str | None,
                    q: str | None, status: str | None) -> DocumentListResponse:
    session = SessionLocal()
    try:
        return list_documents(session, owner_user_id=owner_user_id, limit=limit,
                              cursor=cursor, q=q, status=status)
    finally:
        session.close()


def _workspace_stats(owner_user_id: str) -> WorkspaceStats:
    session = SessionLocal()
    try:
        return workspace_stats(session, owner_user_id=owner_user_id)
    finally:
        session.close()


@router.get("/documents/stats", response_model=WorkspaceStats,
            dependencies=[Depends(require_internal_token)])
def workspace_stats_endpoint(owner_user_id: str):
    return _workspace_stats(owner_user_id)


@router.get("/documents", response_model=DocumentListResponse,
            dependencies=[Depends(require_internal_token)])
def list_documents_endpoint(owner_user_id: str, limit: int = 30,
                            cursor: str | None = None, q: str | None = None,
                            status: str | None = None):
    try:
        return _list_documents(owner_user_id, min(max(limit, 1), 100), cursor, q, status)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid cursor")


def _upload_dir() -> Path:
    return Path(settings.upload_dir)


async def enqueue_ingest(content_hash: str, job_id: str) -> None:
    pool = await create_pool(redis_settings())
    try:
        await pool.enqueue_job("ingest_document", content_hash, job_id, _job_id=job_id)
    finally:
        await pool.aclose()


def _mark_enqueue_failed(content_hash: str, job_id: str, reason: str) -> None:
    """enqueue 失敗時、新規セッションで job/content を error にする。"""
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        content = session.get(Content, content_hash)
        if job:
            job.status = "error"
            job.error = reason
        if content:
            content.status = "error"
            content.error = reason
        session.commit()
    finally:
        session.close()


@router.post("/documents", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def create_document(file: UploadFile = File(...), owner_user_id: str = Form(...)):
    upload_dir = _upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = file.filename or "file"
    data = await file.read()
    content_hash = hashlib.sha256(data).hexdigest()
    ext = Path(filename).suffix
    mime = file.content_type or "application/octet-stream"

    enqueue_job_id: str | None = None  # 新規解析が必要な時だけセット
    try:
        session = SessionLocal()
        try:
            # contents 行をロックして dedup（削除GCとの直列化）。
            content = (session.query(Content)
                       .filter(Content.content_hash == content_hash)
                       .with_for_update()
                       .one_or_none())

            if content is None:
                # 新規実体: 原本を hash 命名で 1 個だけ保存し、解析ジョブを作る。
                raw_path = upload_dir / f"{content_hash}{ext}"
                raw_path.write_bytes(data)
                content = Content(content_hash=content_hash, mime=mime, size=len(data),
                                  raw_path=str(raw_path), status="queued", ref_count=0)
                session.add(content)
                try:
                    session.flush()
                except IntegrityError:
                    # 別リクエストが同時に同一実体を作成。原本を捨て既存を参照する。
                    session.rollback()
                    raw_path.unlink(missing_ok=True)
                    content = (session.query(Content)
                               .filter(Content.content_hash == content_hash)
                               .with_for_update().one())
                else:
                    job = IngestJob(content_hash=content_hash, status="queued")
                    session.add(job)
                    session.flush()
                    enqueue_job_id = job.id
            elif content.status == "error":
                # 既存実体が解析失敗のまま: 再解析ジョブを作って queued に戻す。
                content.status = "queued"
                content.error = None
                job = IngestJob(content_hash=content_hash, status="queued")
                session.add(job)
                session.flush()
                enqueue_job_id = job.id

            # 同一ユーザーの二重参照は 409。
            existing_doc = (session.query(Document)
                            .filter(Document.owner_user_id == owner_user_id,
                                    Document.content_hash == content_hash)
                            .one_or_none())
            if existing_doc:
                raise HTTPException(status_code=409, detail="duplicate document")

            doc = Document(owner_user_id=owner_user_id, content_hash=content_hash,
                           filename=filename)
            session.add(doc)
            content.ref_count = content.ref_count + 1

            if enqueue_job_id is not None:
                job_id = enqueue_job_id
            else:
                latest = (session.query(IngestJob)
                          .filter(IngestJob.content_hash == content_hash)
                          .order_by(IngestJob.created_at.desc()).first())
                job_id = latest.id if latest else None

            session.flush()
            session.commit()
            result = IngestStarted(document_id=doc.id, job_id=job_id or "")
        finally:
            session.close()
    except HTTPException:
        raise
    except IntegrityError:
        # 同時二重アップロードの競合: UNIQUE 違反を 409 に正規化。
        raise HTTPException(status_code=409, detail="duplicate document")

    if enqueue_job_id is not None:
        try:
            await enqueue_ingest(content_hash, result.job_id)
        except Exception as exc:  # noqa: BLE001
            _mark_enqueue_failed(content_hash, result.job_id, f"enqueue failed: {exc}")
            raise HTTPException(status_code=502, detail="ingest enqueue failed") from exc

    return result


@router.post("/jobs/{job_id}/retry", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def retry_job(job_id: str, owner_user_id: str | None = None):
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        # owner_user_id が渡された場合は所有者一致を強制（web 経由の IDOR を防ぐ）。
        if not job or (owner_user_id is not None and job.owner_user_id != owner_user_id):
            raise HTTPException(status_code=404, detail="job not found")
        if job.status not in ("ready", "error"):
            raise HTTPException(status_code=409, detail=f"job is {job.status}, cannot retry")
        job.status = "queued"; job.progress = 0; job.error = None; job.stage_detail = ""
        doc = session.get(Document, job.document_id)
        if doc:
            doc.status = "queued"
        session.commit()
        result = IngestStarted(document_id=job.document_id, job_id=job.id)
    finally:
        session.close()
    await enqueue_ingest(result.document_id, result.job_id)
    return result


@router.post("/jobs/{job_id}/cancel", status_code=204,
             dependencies=[Depends(require_internal_token)])
def cancel_job(job_id: str, owner_user_id: str | None = None):
    """待機中(queued)ジョブの取り消し。行と生ファイルを削除する。
    queued 以外は 409。Worker 着手との競合は status 条件付き DELETE で原子化。"""
    session = SessionLocal()
    raw_path: str | None = None
    parsed_md_path: str | None = None
    try:
        job = session.get(IngestJob, job_id)
        if not job or (owner_user_id is not None and job.owner_user_id != owner_user_id):
            raise HTTPException(status_code=404, detail="job not found")
        if job.status != "queued":
            raise HTTPException(status_code=409, detail=f"job is {job.status}, cannot cancel")
        doc = session.get(Document, job.document_id)
        raw_path = doc.raw_path if doc else None
        parsed_md_path = doc.parsed_md_path if doc else None
        # status='queued' の行だけを原子的に削除。0件なら Worker が着手済みなので 409。
        deleted = (
            session.query(IngestJob)
            .filter(IngestJob.id == job_id, IngestJob.status == "queued")
            .delete()
        )
        if not deleted:
            session.rollback()
            raise HTTPException(status_code=409, detail="job is no longer queued, cannot cancel")
        if doc:
            QdrantStore().delete_by_document(doc.id)
            session.query(Chunk).filter(Chunk.document_id == doc.id).delete()
            session.delete(doc)
        session.commit()
    finally:
        session.close()
    cleanup_document_files(raw_path, parsed_md_path)
    return Response(status_code=204)


def _delete_one(session: Session, doc: Document) -> tuple[str | None, str | None]:
    """1文書の Qdrant ベクトル/chunks/job/行を削除し、cleanup 対象の生ファイルパスを返す。
    commit と cleanup_document_files は呼び出し側で行う。"""
    raw_path, parsed_md_path = doc.raw_path, doc.parsed_md_path
    QdrantStore().delete_by_document(doc.id)
    session.query(Chunk).filter(Chunk.document_id == doc.id).delete()
    session.query(IngestJob).filter(IngestJob.document_id == doc.id).delete()
    session.delete(doc)
    return raw_path, parsed_md_path


@router.delete("/documents/{document_id}", status_code=204,
               dependencies=[Depends(require_internal_token)])
def delete_document(document_id: str, owner_user_id: str):
    session = SessionLocal()
    raw_path: str | None = None
    parsed_md_path: str | None = None
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path, parsed_md_path = _delete_one(session, doc)
        record_workspace_activity(session, owner_user_id=owner_user_id)
        session.commit()
    finally:
        session.close()
    cleanup_document_files(raw_path, parsed_md_path)
    return Response(status_code=204)


# 静的パス /documents/bulk-delete は {document_id} 系ルートより前に登録する（誤マッチ回避）。
@router.post("/documents/bulk-delete", response_model=BulkDeleteResponse,
             dependencies=[Depends(require_internal_token)])
def bulk_delete_documents(req: BulkDeleteRequest):
    """複数文書をまとめて削除する。所有者不一致・不在は not_found に入れて部分成功を許容。"""
    session = SessionLocal()
    deleted: list[str] = []
    not_found: list[str] = []
    files: list[tuple[str | None, str | None]] = []
    try:
        for doc_id in req.document_ids:
            doc = session.get(Document, doc_id)
            if not doc or doc.owner_user_id != req.owner_user_id:
                not_found.append(doc_id)
                continue
            files.append(_delete_one(session, doc))
            deleted.append(doc_id)
        if deleted:
            record_workspace_activity(session, owner_user_id=req.owner_user_id)
        session.commit()
    finally:
        session.close()
    for raw, md in files:
        cleanup_document_files(raw, md)
    return BulkDeleteResponse(deleted=deleted, not_found=not_found)


def _fetch_document(document_id: str, req: FetchDocumentRequest) -> FetchDocumentResponse:
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != req.owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        rows = (session.query(Chunk)
                .filter(Chunk.document_id == document_id)
                .order_by(Chunk.ordinal).all())
        around = None
        if req.around_chunk_id:
            center = next((c for c in rows if c.id == req.around_chunk_id), None)
            # around_chunk_id が見つからない場合は窓掛けせず先頭から返す（意図的フォールバック）
            around = center.ordinal if center else None
        rows = select_chunks(rows, around_ordinal=around)
        return FetchDocumentResponse(
            document_id=doc.id, document_title=doc.filename,
            chunks=[FetchedChunk(chunk_id=c.id, ordinal=c.ordinal, heading_path=c.heading_path,
                                 page_start=c.page_start, page_end=c.page_end,
                                 block_type=c.block_type, text=c.text) for c in rows])
    finally:
        session.close()


@router.post("/documents/{document_id}/chunks", response_model=FetchDocumentResponse,
             dependencies=[Depends(require_internal_token)])
def fetch_document_chunks(document_id: str, req: FetchDocumentRequest):
    return _fetch_document(document_id, req)


def _preview_document(document_id: str, owner_user_id: str) -> FetchDocumentResponse:
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        rows = (session.query(Chunk)
                .filter(Chunk.document_id == document_id)
                .order_by(Chunk.ordinal).all())
        return FetchDocumentResponse(
            document_id=doc.id, document_title=doc.filename,
            chunks=[FetchedChunk(chunk_id=c.id, ordinal=c.ordinal, heading_path=c.heading_path,
                                 page_start=c.page_start, page_end=c.page_end,
                                 block_type=c.block_type, text=c.text) for c in rows])
    finally:
        session.close()


@router.get("/documents/{document_id}/preview", response_model=FetchDocumentResponse,
            dependencies=[Depends(require_internal_token)])
def preview_document(document_id: str, owner_user_id: str):
    return _preview_document(document_id, owner_user_id)


# フロントの原本存在確認は HEAD（right-panel）。FastAPI は GET ルートへ HEAD を
# 自動付与しないため明示的に許可する。FileResponse は HEAD では本文を送らない。
@router.api_route("/documents/{document_id}/raw", methods=["GET", "HEAD"],
                  dependencies=[Depends(require_internal_token)])
def get_document_raw(document_id: str, owner_user_id: str, download: bool = False):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = Path(doc.raw_path)
        mime = doc.mime
        filename = doc.filename
    finally:
        session.close()
    if not raw_path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(
        str(raw_path),
        media_type=mime or "application/octet-stream",
        filename=filename,
        content_disposition_type="attachment" if download else "inline",
    )


@router.get("/documents/{document_id}/rendered",
            dependencies=[Depends(require_internal_token)])
def get_document_rendered(document_id: str, owner_user_id: str):
    """Office 系原本を LibreOffice で PDF 化（遅延・キャッシュ）して inline 返却する。"""
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = Path(doc.raw_path)
    finally:
        session.close()
    if not is_convertible(str(raw_path)):
        raise HTTPException(status_code=404, detail="not convertible")
    if not raw_path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    try:
        pdf = convert_to_pdf(str(raw_path))
    except Exception as exc:  # 変換失敗（破損・タイムアウト・未対応）
        raise HTTPException(status_code=422, detail="conversion failed") from exc
    return FileResponse(str(pdf), media_type="application/pdf",
                        content_disposition_type="inline")


@router.get("/documents/{document_id}/layout",
            dependencies=[Depends(require_internal_token)])
def get_document_layout(document_id: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = doc.raw_path
    finally:
        session.close()
    layout = find_layout_pdf(raw_path)
    if layout is None or not layout.is_file():
        raise HTTPException(status_code=404, detail="layout not found")
    return FileResponse(str(layout), media_type="application/pdf",
                        content_disposition_type="inline")


@router.get("/documents/{document_id}/span",
            dependencies=[Depends(require_internal_token)])
def get_document_span(document_id: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = doc.raw_path
    finally:
        session.close()
    span = find_span_pdf(raw_path)
    if span is None or not span.is_file():
        raise HTTPException(status_code=404, detail="span not found")
    return FileResponse(str(span), media_type="application/pdf",
                        content_disposition_type="inline")


@router.get("/documents/{document_id}/assets/{asset_path:path}",
            dependencies=[Depends(require_internal_token)])
def get_document_asset(document_id: str, asset_path: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = doc.raw_path
    finally:
        session.close()
    target = resolve_within(assets_dir_for(raw_path), asset_path)
    if target is None or not target.is_file():
        raise HTTPException(status_code=404, detail="asset not found")
    return FileResponse(str(target))
