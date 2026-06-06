import gzip
import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from eval.beir import _download  # SSL フォールバック付きダウンローダを共用
from eval.dataset import Thresholds


@dataclass(frozen=True)
class HotpotConfig:
    suite: str
    split: str
    owner_user_id: str
    thresholds: Thresholds
    # 入力ソースは2系統。source_path（repo 同梱・絶対パス・.gz 可）を優先、無ければ source_url を DL。
    source_path: str | None = None
    source_url: str | None = None
    query_limit: int | None = None


_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")
# yes/no 系・空答えは部分一致が無意味（"yes" は本文に頻出）なので fact_coverage 対象外にする。
_TRIVIAL_ANSWERS = {"", "yes", "no", "noanswer"}


def load_hotpot_config(path: str | Path) -> HotpotConfig:
    path = Path(path)
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    source_path = data.get("source_path")
    if source_path:
        # suite.yaml からの相対指定を絶対パスへ解決（同梱データを指す）。
        source_path = str((path.parent / source_path).resolve())
    return HotpotConfig(
        suite=data["suite"],
        split=data.get("split", "dev"),
        owner_user_id=data.get("owner_user_id", f"__eval_{data['suite']}__"),
        thresholds=Thresholds.model_validate(data.get("thresholds", {})),
        source_path=source_path,
        source_url=data.get("source_url"),
        query_limit=data.get("query_limit"),
    )


def _read_records(config: HotpotConfig, cache_dir: str | Path) -> list[dict[str, Any]]:
    """source_path（同梱・gz 可）を優先、無ければ source_url を DL して JSON を読む。"""
    if config.source_path:
        path = Path(config.source_path)
    elif config.source_url:
        path = _download(config.source_url, Path(cache_dir))
    else:
        raise ValueError("hotpot: source_path か source_url のいずれかが必要です")
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def _title_filename(title: str) -> str:
    # タイトルを安全なファイル名へ。別タイトルが同じ safe 名へ衝突しないよう短いハッシュを付す。
    safe = _SAFE.sub("_", title).strip("._") or "doc"
    digest = hashlib.sha1(title.encode("utf-8")).hexdigest()[:8]
    return f"{safe[:80]}__{digest}.txt"


def _paragraph_text(title: str, sentences: list[str]) -> str:
    body = "".join(sentences).strip()
    return f"# {title}\n\n{body}\n"


def build_hotpot_suite(records: Iterable[dict[str, Any]], config: HotpotConfig,
                       assets_dir: str | Path) -> dict[str, Any]:
    """HotpotQA レコード列 → テキスト資産書き出し + suite dict（純変換寄り）。

    全設問の context 段落を 1 つの共有コーパスへ畳み込み（タイトルで一意化）、
    supporting_facts のタイトルを relevant_documents、answer を key_facts にする。
    """
    assets = Path(assets_dir)
    assets.mkdir(parents=True, exist_ok=True)

    records = list(records)
    if config.query_limit and config.query_limit > 0:
        records = records[:config.query_limit]

    title_to_filename: dict[str, str] = {}
    title_to_text: dict[str, str] = {}
    cases: list[dict[str, Any]] = []
    for item in records:
        # context 段落をコーパスへ登録（初出のタイトルのみ採用）
        for title, sentences in item.get("context", []):
            if title in title_to_filename:
                continue
            title_to_filename[title] = _title_filename(title)
            title_to_text[title] = _paragraph_text(title, sentences)

        # supporting_facts のタイトル集合 = 正解文書。初出順を保持して重複排除。
        gold: list[str] = []
        seen: set[str] = set()
        for title, _sent_id in item.get("supporting_facts", []):
            if title in title_to_filename and title not in seen:
                seen.add(title)
                gold.append(title)
        if not gold:
            continue
        relevant = sorted(title_to_filename[t] for t in gold)

        answer = (item.get("answer") or "").strip()
        key_facts = [] if answer.lower() in _TRIVIAL_ANSWERS else [{"any": [answer]}]

        tags = ["hotpot", config.split]
        if item.get("type"):
            tags.append(item["type"])
        cases.append({
            "id": f"hotpot-{config.split}-{item['_id']}",
            "query": item["question"],
            "top_k": 10,
            "tags": tags,
            "relevant_documents": relevant,
            "key_facts": key_facts,
        })

    for title, filename in title_to_filename.items():
        (assets / filename).write_text(title_to_text[title], encoding="utf-8")

    return {
        "suite": config.suite,
        "owner_user_id": config.owner_user_id,
        "files_dir": str(assets),
        "documents": sorted(title_to_filename.values()),
        "thresholds": config.thresholds.model_dump(exclude_none=True),
        "cases": cases,
    }


def prepare_hotpot_suite(config: HotpotConfig, assets_dir: str | Path,
                         golden_out: str | Path, cache_dir: str | Path) -> Path:
    records = _read_records(config, cache_dir)
    suite = build_hotpot_suite(records, config, assets_dir)
    golden = Path(golden_out)
    golden.parent.mkdir(parents=True, exist_ok=True)
    golden.write_text(yaml.safe_dump(suite, allow_unicode=True, sort_keys=False),
                      encoding="utf-8")
    return golden
