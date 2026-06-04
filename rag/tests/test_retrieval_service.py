import uuid

from app.db import SessionLocal
from app.embedding.factory import StubEmbedder
from app.models import Chunk, Content, Document
from app.reranker.base import Reranker
from app.retrieval.service import retrieve
from app.vectorstore.qdrant import QdrantStore


class IdentityReranker(Reranker):
    name = "identity"

    def score(self, query, passages):
        return [1.0 for _ in passages]


def _seed_indexed(session, store, owner, content_hash, filename, text):
    session.add(Content(content_hash=content_hash, mime="application/pdf", size=10,
                        raw_path=f"/tmp/{content_hash}.pdf", status="ready", ref_count=1))
    session.flush()
    doc = Document(owner_user_id=owner, content_hash=content_hash, filename=filename)
    session.add(doc)
    chunk = Chunk(content_hash=content_hash, ordinal=0, heading_path="見出し",
                  page_start=1, page_end=1, block_type="text", token_len=3, text=text)
    session.add(chunk)
    session.commit()
    emb = StubEmbedder(dim=8)
    vec = emb.embed([text])[0]
    store.upsert([{
        "chunk_id": chunk.id, "content_hash": content_hash, "heading_path": "見出し",
        "page_start": 1, "page_end": 1, "block_type": "text", "source_type": "doc",
        "text": text, "vector": vec,
    }])
    return doc.id


def test_retrieve_returns_owner_document_id_for_shared_content():
    """共有 content をヒットさせても、結果の document_id は問い合わせ owner の参照になる。"""
    session = SessionLocal()
    store = QdrantStore(collection="test_ret_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    o1, o2 = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    text = "決算は黒字でした。"
    try:
        d1 = _seed_indexed(session, store, o1, h, "o1.pdf", text)
        # o2 も同じ content を参照（ベクトルは共有、再 upsert しない）
        session.add(Document(owner_user_id=o2, content_hash=h, filename="o2.pdf"))
        c = session.get(Content, h); c.ref_count = 2
        session.commit()

        emb = StubEmbedder(dim=8)
        r1 = retrieve(session, store, emb, IdentityReranker(),
                      query=text, owner_user_id=o1, top_k=3, candidate_k=5)
        assert r1 and r1[0].document_id == d1
        assert r1[0].document_title == "o1.pdf"

        # o2 から引くと o2 の document_id / filename になる
        d2 = (session.query(Document)
              .filter_by(owner_user_id=o2, content_hash=h).one()).id
        r2 = retrieve(session, store, emb, IdentityReranker(),
                      query=text, owner_user_id=o2, top_k=3, candidate_k=5)
        assert r2 and r2[0].document_id == d2
        assert r2[0].document_title == "o2.pdf"
    finally:
        store.drop()
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_retrieve_excludes_non_referencing_user():
    """参照を持たない owner には共有 content がヒットしない。"""
    session = SessionLocal()
    store = QdrantStore(collection="test_ret_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    owner, intruder = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    text = "社外秘の数値。"
    try:
        _seed_indexed(session, store, owner, h, "o.pdf", text)
        emb = StubEmbedder(dim=8)
        r = retrieve(session, store, emb, IdentityReranker(),
                     query=text, owner_user_id=intruder, top_k=3, candidate_k=5)
        assert r == []
    finally:
        store.drop()
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_retrieve_scopes_to_document_ids():
    """document_ids 指定時は、その owner の指定 library entry のみに絞り込まれる。"""
    session = SessionLocal()
    store = QdrantStore(collection="test_ret_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    owner = "u_" + uuid.uuid4().hex
    ha, hb = "h_" + uuid.uuid4().hex, "h_" + uuid.uuid4().hex
    text_a, text_b = "売上は増加しました。", "費用は減少しました。"
    try:
        da = _seed_indexed(session, store, owner, ha, "a.pdf", text_a)
        db = _seed_indexed(session, store, owner, hb, "b.pdf", text_b)
        emb = StubEmbedder(dim=8)
        # da だけにスコープ → b.pdf は返らない
        r = retrieve(session, store, emb, IdentityReranker(),
                     query=text_a, owner_user_id=owner, top_k=5, candidate_k=10,
                     document_ids=[da])
        assert r, "スコープ内の文書はヒットすること"
        assert all(c.document_id == da for c in r)
        assert all(c.document_title == "a.pdf" for c in r)
        assert db not in {c.document_id for c in r}
    finally:
        store.drop()
        for h in (ha, hb):
            session.query(Chunk).filter_by(content_hash=h).delete()
            session.query(Document).filter_by(content_hash=h).delete()
            session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()
