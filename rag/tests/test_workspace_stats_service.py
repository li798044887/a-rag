from datetime import datetime
from types import SimpleNamespace

from app.documents_service import workspace_stats


class _Query:
    def __init__(self, rows=None, *, count=0, scalar=None):
        self._rows = rows or []
        self._count = count
        self._scalar = scalar

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def count(self):
        return self._count

    def scalar(self):
        return self._scalar

    def all(self):
        return self._rows


def test_workspace_stats_counts_ready_docs_upload_source_and_last_ready_job():
    latest = datetime(2026, 5, 31, 8, 14)

    class _Session:
        def __init__(self):
            self.calls = 0

        def query(self, *entities):
            self.calls += 1
            if self.calls == 1:
                return _Query(count=3)
            if self.calls == 2:
                return _Query(count=2)
            return _Query([SimpleNamespace(created_at=latest)])

    stats = workspace_stats(_Session(), owner_user_id="u1")

    assert stats.indexed_document_count == 2
    assert stats.total_document_count == 3
    assert stats.connected_data_source_count == 1
    assert stats.last_synced_at == latest


def test_workspace_stats_has_no_connected_source_without_documents():
    class _Session:
        def __init__(self):
            self.calls = 0

        def query(self, *entities):
            self.calls += 1
            return _Query(count=0)

    stats = workspace_stats(_Session(), owner_user_id="u1")

    assert stats.indexed_document_count == 0
    assert stats.total_document_count == 0
    assert stats.connected_data_source_count == 0
    assert stats.last_synced_at is None
