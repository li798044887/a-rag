from app.worker import run_ingest


class _EmptySession:
    """get が常に None を返す（= キャンセルで行が消えた状態）。"""
    def get(self, model, _id):
        return None


class _BoomStore:
    def ensure_collection(self):
        raise AssertionError("store に触れてはいけない（早期 return すべき）")


def test_run_ingest_noop_when_doc_or_job_missing():
    # doc/job が無いとき run_ingest は例外を投げず、処理にも入らず終わる。
    run_ingest(_EmptySession(), _BoomStore(), embedder=None,
               parse_fn=None, document_id="gone", job_id="gone")
