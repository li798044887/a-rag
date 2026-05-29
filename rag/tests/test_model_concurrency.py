"""並列 retrieve でモデル singleton を同時に触っても壊れないことを保証する回帰テスト。

背景: `/retrieve` は同期 (def) ルートのため Starlette のスレッドプールで実行される。
モデルが並列ツール呼び出しで同時に retrieve されると、共有 singleton の BGE モデル
（PyTorch + HuggingFace fast tokenizer = スレッド非安全）へ複数スレッドが同時アクセスし、
2 件目が即座に 500 で落ちていた。ファクトリの遅延初期化とモデル推論を直列化して防ぐ。
"""
import threading
import time

import app.embedding.factory as ef
import app.reranker.factory as rf
from app.embedding.bge_m3 import BGEM3Embedder
from app.reranker.bge import BGEReranker


def test_get_embedder_builds_once_under_concurrency(monkeypatch):
    calls: list[int] = []

    class SlowStub:
        dim = 8

        def __init__(self) -> None:
            calls.append(1)
            time.sleep(0.05)  # コンストラクタを遅くして競合窓を広げる

        def embed(self, texts):  # pragma: no cover - 本テストでは未使用
            return []

    monkeypatch.setenv("EMBEDDER", "stub")
    monkeypatch.setattr(ef, "StubEmbedder", SlowStub)
    ef._cache.clear()
    try:
        results: list[object] = []

        def worker() -> None:
            results.append(ef.get_embedder())

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(calls) == 1, "並列でも singleton は 1 回しか構築されないこと"
        assert len({id(r) for r in results}) == 1
    finally:
        ef._cache.clear()


def test_get_reranker_builds_once_under_concurrency(monkeypatch):
    calls: list[int] = []

    class SlowStub:
        def __init__(self) -> None:
            calls.append(1)
            time.sleep(0.05)

        def score(self, query, docs):  # pragma: no cover
            return []

    monkeypatch.setenv("RERANKER", "stub")
    monkeypatch.setattr(rf, "StubReranker", SlowStub)
    rf._cache.clear()
    try:
        results: list[object] = []

        def worker() -> None:
            results.append(rf.get_reranker())

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(calls) == 1
        assert len({id(r) for r in results}) == 1
    finally:
        rf._cache.clear()


def _make_overlap_detector():
    state = {"max": 0, "cur": 0}
    guard = threading.Lock()

    def enter() -> None:
        with guard:
            state["cur"] += 1
            state["max"] = max(state["max"], state["cur"])

    def leave() -> None:
        with guard:
            state["cur"] -= 1

    return state, enter, leave


def test_embedder_serializes_concurrent_inference():
    state, enter, leave = _make_overlap_detector()

    class FakeModel:
        def encode(self, texts, **kwargs):
            enter()
            time.sleep(0.02)
            leave()
            n = len(texts)
            return {"dense_vecs": [[0.0]] * n, "lexical_weights": [{}] * n}

    # __init__ は実モデルをロードするため回避して内部状態だけ用意する。
    emb = object.__new__(BGEM3Embedder)
    emb._lock = threading.Lock()
    emb.model = FakeModel()

    threads = [threading.Thread(target=lambda: emb.embed(["x"])) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert state["max"] == 1, "推論が並列に重なってはならない（モデルはスレッド非安全）"


def test_reranker_serializes_concurrent_inference():
    state, enter, leave = _make_overlap_detector()

    class FakeModel:
        def compute_score(self, pairs, **kwargs):
            enter()
            time.sleep(0.02)
            leave()
            return [0.0 for _ in pairs]

    rk = object.__new__(BGEReranker)
    rk._lock = threading.Lock()
    rk.model = FakeModel()

    threads = [threading.Thread(target=lambda: rk.score("q", ["a", "b"])) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert state["max"] == 1
