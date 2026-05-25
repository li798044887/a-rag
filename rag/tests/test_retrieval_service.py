import uuid

from app.db import SessionLocal
from app.models import Chunk, Document
from app.embedding.factory import StubEmbedder
from app.reranker.factory import StubReranker
from app.retrieval.service import retrieve
from app.vectorstore.qdrant import QdrantStore

COLL = "test_retr_" + uuid.uuid4().hex[:8]


def test_retrieve_reranks_and_expands_neighbors():
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection=COLL, dim=8)
    store.ensure_collection()
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="設計.pdf", mime="application/pdf",
                   size=1, raw_path="/tmp/x", status="ready")
    session.add(doc); session.flush()

    bodies = ["前の文脈。", "認証トークンは24時間で失効する。", "次の文脈。"]
    rows = []
    for i, b in enumerate(bodies):
        c = Chunk(document_id=doc.id, ordinal=i, heading_path="認証", page_start=0,
                  page_end=0, block_type="text", token_len=len(b), text=b)
        session.add(c); session.flush(); rows.append(c)
    session.commit()
    store.upsert([
        {"chunk_id": c.id, "document_id": doc.id, "owner_user_id": "u1",
         "heading_path": "認証", "page_start": 0, "page_end": 0, "block_type": "text",
         "source_type": "doc", "text": c.text, "vector": e.embed([c.text])[0]}
        for c in rows
    ])

    res = retrieve(session, store, e, r, query="認証トークン 失効",
                   owner_user_id="u1", top_k=1, candidate_k=10)
    assert len(res) == 1
    top = res[0]
    assert "失効する" in top.text
    assert top.document_title == "設計.pdf"
    # 近傍拡張: 前後の文脈が expanded_text に含まれる
    assert "前の文脈" in top.expanded_text and "次の文脈" in top.expanded_text

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit(); session.close()
