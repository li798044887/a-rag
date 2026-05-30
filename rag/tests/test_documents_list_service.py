from datetime import datetime
from types import SimpleNamespace

from app.documents_service import list_documents


class _Query:
    """filter/order_by/limit/count/all をチェーン可能にする最小スタブ。"""

    def __init__(self, rows, *, count=None):
        self._rows = rows
        self._count = count if count is not None else len(rows)

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def group_by(self, *a, **k):
        return self

    def count(self):
        return self._count

    def all(self):
        return self._rows


def _doc(i):
    return SimpleNamespace(
        id=f"d{i}", filename=f"f{i}.pdf", mime="application/pdf", size=10,
        page_count=2, status="ready", raw_path=f"/u/d{i}.pdf",
        created_at=datetime(2026, 5, 31, 0, i),
    )


def test_list_documents_returns_items_total_and_next_cursor():
    docs = [_doc(2), _doc(1), _doc(0)]  # created_at desc 前提

    class _Session:
        def __init__(self):
            self.calls = 0

        def query(self, *entities):
            self.calls += 1
            # 1回目: total カウント / 2回目: ページ本体 / 3回目: chunk 集計 / 4回目: jobs
            if self.calls == 1:
                return _Query([], count=3)
            if self.calls == 2:
                return _Query(list(docs))
            if self.calls == 3:
                return _Query([("d2", 5)])  # chunk_count; d1 は集計に無いので 0 になる
            return _Query([
                SimpleNamespace(id="j2", document_id="d2", error=None,
                                created_at=datetime(2026, 5, 31, 0, 2)),
            ])

    resp = list_documents(_Session(), owner_user_id="u1", limit=2)
    assert resp.total == 3
    assert [it.id for it in resp.items] == ["d2", "d1"]  # limit=2 で打ち切り
    assert resp.items[0].chunk_count == 5
    assert resp.items[0].latest_job_id == "j2"
    assert resp.items[1].chunk_count == 0  # 集計に無ければ 0
    assert resp.next_cursor is not None  # 3 件中 2 件取得 → 続きあり
