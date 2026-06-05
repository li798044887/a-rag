import argparse
import json
import sys
from pathlib import Path

from app.db import SessionLocal
from app.embedding.factory import get_embedder
from app.reranker.factory import get_reranker
from app.retrieval.service import retrieve as retrieve_service
from app.vectorstore.qdrant import QdrantStore
from eval.corpus import ingest_files, resolve
from eval.dataset import load_suite
from eval.report import diff_baseline, gate_failures, to_markdown
from eval.runner import run_suite

EVAL_DIR = Path(__file__).parent
DEFAULT_GOLDEN = EVAL_DIR / "golden" / "agentic_rag.yaml"
# コンテナ内では docker-compose の read-only マウント先。ローカル直実行時は --files-dir で上書き。
DEMO_DIR = Path("/data/demo-files")


def _cmd_ingest(args) -> int:
    suite = load_suite(args.golden)
    session = SessionLocal()
    try:
        embedder = get_embedder()
        store = QdrantStore(dim=embedder.dim)
        store.ensure_collection()
        ingest_files(session, store, embedder, suite.owner_user_id,
                     args.files_dir, suite.documents)
    finally:
        session.close()
    print(f"取り込み完了: {len(suite.documents)} 文書 / owner={suite.owner_user_id}")
    return 0


def _cmd_run(args) -> int:
    suite = load_suite(args.golden)
    session = SessionLocal()
    try:
        embedder = get_embedder()
        reranker = get_reranker()
        store = QdrantStore(dim=embedder.dim)
        resolve(session, suite.owner_user_id, suite.documents)  # 取り込み済み検証

        def retrieve_fn(query: str, owner: str, top_k: int):
            return retrieve_service(session, store, embedder, reranker,
                                    query=query, owner_user_id=owner, top_k=top_k)

        result = run_suite(suite, retrieve_fn)
    finally:
        session.close()

    print(to_markdown(result))
    if args.out:
        Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2),
                                  encoding="utf-8")
    if args.baseline and Path(args.baseline).exists():
        baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
        print("\n## ベースライン差分")
        for k, d in diff_baseline(result, baseline).items():
            print(f"- {k}: {d:+.3f}")
    if args.gate:
        failures = gate_failures(result, suite.thresholds)
        if failures:
            print("\nゲート失敗:", file=sys.stderr)
            for f in failures:
                print(" -", f, file=sys.stderr)
            return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="eval")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ing = sub.add_parser("ingest", help="ゴールデン文書を取り込む")
    p_ing.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    p_ing.add_argument("--files-dir", default=str(DEMO_DIR))
    p_ing.set_defaults(func=_cmd_ingest)

    p_run = sub.add_parser("run", help="評価を実行")
    p_run.add_argument("--golden", default=str(DEFAULT_GOLDEN))
    p_run.add_argument("--out", default=None, help="レポート JSON 出力先")
    p_run.add_argument("--baseline", default=None, help="ベースライン JSON")
    p_run.add_argument("--gate", action="store_true", help="閾値未達で非ゼロ終了")
    p_run.set_defaults(func=_cmd_run)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
