import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

from app.db import SessionLocal
from app.embedding.factory import get_embedder
from app.reranker.factory import get_reranker
from app.retrieval.service import retrieve as retrieve_service
from app.vectorstore.qdrant import QdrantStore
from eval.beir import load_beir_config, prepare_beir_suite
from eval.corpus import ingest_files, resolve
from eval.hotpot import load_hotpot_config, prepare_hotpot_suite
from eval.dataset import load_suite
from eval.report import diff_baseline, gate_failures, to_markdown
from eval.runner import run_suite

EVAL_DIR = Path(__file__).parent
SUITES_DIR = EVAL_DIR / "suites"
DEFAULT_SUITE = "beir_scifact"
DEFAULT_ASSETS_ROOT = Path("/data/eval-assets")
DEFAULT_REPORT_ROOT = Path("/data/eval-reports")
DEFAULT_CACHE_DIR = Path("/data/eval-cache")
DEFAULT_BASELINE = "bge-m3__bge.json"


def _suite_dir(name: str) -> Path:
    return SUITES_DIR / name


def _resolve_golden(args) -> Path:
    if args.golden:
        return Path(args.golden)
    return _suite_dir(args.suite) / "golden.yaml"


def _resolve_files_dir(args, suite) -> Path:
    if args.files_dir:
        return Path(args.files_dir)
    if suite.files_dir:
        return Path(suite.files_dir)
    return DEFAULT_ASSETS_ROOT / suite.suite


def _resolve_baseline(args) -> Path | None:
    if args.baseline:
        return Path(args.baseline)
    path = _suite_dir(args.suite) / "baselines" / DEFAULT_BASELINE
    return path if path.exists() else None


def _cmd_prepare_beir(args) -> int:
    config = load_beir_config(_suite_dir(args.suite) / "suite.yaml")
    assets_dir = Path(args.assets_dir) if args.assets_dir else DEFAULT_ASSETS_ROOT / config.suite
    golden_out = Path(args.golden_out) if args.golden_out else DEFAULT_REPORT_ROOT / config.suite / "golden.yaml"
    query_limit = args.query_limit if args.query_limit is not None else config.query_limit
    corpus_limit = args.corpus_limit if args.corpus_limit is not None else config.corpus_limit
    config = replace(config, query_limit=query_limit, corpus_limit=corpus_limit)
    golden = prepare_beir_suite(config, assets_dir, golden_out, args.cache_dir)
    print(f"BEIR suite prepared: {config.suite} -> {golden}")
    return 0


def _cmd_prepare_hotpot(args) -> int:
    config = load_hotpot_config(_suite_dir(args.suite) / "suite.yaml")
    assets_dir = Path(args.assets_dir) if args.assets_dir else DEFAULT_ASSETS_ROOT / config.suite
    golden_out = Path(args.golden_out) if args.golden_out else DEFAULT_REPORT_ROOT / config.suite / "golden.yaml"
    query_limit = args.query_limit if args.query_limit is not None else config.query_limit
    config = replace(config, query_limit=query_limit)
    golden = prepare_hotpot_suite(config, assets_dir, golden_out, args.cache_dir)
    print(f"HotpotQA suite prepared: {config.suite} -> {golden}")
    return 0


def _cmd_ingest(args) -> int:
    suite = load_suite(_resolve_golden(args))
    session = SessionLocal()
    try:
        embedder = get_embedder()
        store = QdrantStore(dim=embedder.dim)
        store.ensure_collection()
        ingest_files(session, store, embedder, suite.owner_user_id,
                     _resolve_files_dir(args, suite), suite.documents)
    finally:
        session.close()
    print(f"取り込み完了: {len(suite.documents)} 文書 / owner={suite.owner_user_id}")
    return 0


def _cmd_run(args) -> int:
    suite = load_suite(_resolve_golden(args))
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
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2),
                            encoding="utf-8")
    baseline_path = _resolve_baseline(args)
    if baseline_path and baseline_path.exists():
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
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

    p_prep = sub.add_parser("prepare-beir", help="BEIR 公開データセットから評価 suite を生成")
    p_prep.add_argument("--suite", default=DEFAULT_SUITE)
    p_prep.add_argument("--assets-dir", default=None)
    p_prep.add_argument("--golden-out", default=None)
    p_prep.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    p_prep.add_argument("--query-limit", type=int, default=None)
    p_prep.add_argument("--corpus-limit", type=int, default=None)
    p_prep.set_defaults(func=_cmd_prepare_beir)

    p_hot = sub.add_parser("prepare-hotpot", help="HotpotQA から評価 suite を生成")
    p_hot.add_argument("--suite", default="hotpot_dev")
    p_hot.add_argument("--assets-dir", default=None)
    p_hot.add_argument("--golden-out", default=None)
    p_hot.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    p_hot.add_argument("--query-limit", type=int, default=None)
    p_hot.set_defaults(func=_cmd_prepare_hotpot)

    p_ing = sub.add_parser("ingest", help="ゴールデン文書を取り込む")
    p_ing.add_argument("--suite", default=DEFAULT_SUITE)
    p_ing.add_argument("--golden", default=None)
    p_ing.add_argument("--files-dir", default=None)
    p_ing.set_defaults(func=_cmd_ingest)

    p_run = sub.add_parser("run", help="評価を実行")
    p_run.add_argument("--suite", default=DEFAULT_SUITE)
    p_run.add_argument("--golden", default=None)
    p_run.add_argument("--out", default=None, help="レポート JSON 出力先")
    p_run.add_argument("--baseline", default=None, help="ベースライン JSON")
    p_run.add_argument("--gate", action="store_true", help="閾値未達で非ゼロ終了")
    p_run.set_defaults(func=_cmd_run)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
