import json
import re
import ssl
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

from eval.dataset import Thresholds


@dataclass(frozen=True)
class BeirConfig:
    suite: str
    dataset: str
    split: str
    source_url: str
    owner_user_id: str
    thresholds: Thresholds
    query_limit: int | None = None
    corpus_limit: int | None = None


_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


def load_beir_config(path: str | Path) -> BeirConfig:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return BeirConfig(
        suite=data["suite"],
        dataset=data["dataset"],
        split=data.get("split", "test"),
        source_url=data["source_url"],
        owner_user_id=data.get("owner_user_id", f"__eval_{data['suite']}__"),
        thresholds=Thresholds.model_validate(data.get("thresholds", {})),
        query_limit=data.get("query_limit"),
        corpus_limit=data.get("corpus_limit"),
    )


def _download(url: str, cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / Path(urlparse(url).path).name
    if not path.exists():
        try:
            urllib.request.urlretrieve(url, path)
        except urllib.error.URLError as exc:
            if not isinstance(getattr(exc, "reason", None), ssl.SSLError):
                raise
            context = ssl._create_unverified_context()
            with urllib.request.urlopen(url, context=context) as response:
                path.write_bytes(response.read())
    return path


def _find(root: Path, name: str) -> Path:
    matches = list(root.rglob(name))
    if not matches:
        raise FileNotFoundError(f"{name} が見つかりません: {root}")
    return matches[0]


def _read_jsonl(path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            out[str(row["_id"])] = row
    return out


def _read_qrels(path: Path) -> dict[str, set[str]]:
    qrels: dict[str, set[str]] = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if not parts or parts[0].lower() in {"query-id", "query_id", "qid"}:
                continue
            if len(parts) < 3:
                continue
            qid, docid, score = parts[0], parts[1], parts[-1]
            try:
                relevant = float(score) > 0
            except ValueError:
                relevant = False
            if relevant:
                qrels.setdefault(qid, set()).add(docid)
    return qrels


def _doc_filename(docid: str) -> str:
    safe = _SAFE.sub("_", docid).strip("._") or "doc"
    return f"{safe}.txt"


def prepare_beir_suite(config: BeirConfig, assets_dir: str | Path,
                       golden_out: str | Path, cache_dir: str | Path) -> Path:
    assets = Path(assets_dir)
    golden = Path(golden_out)
    cache = Path(cache_dir)
    extract_dir = cache / config.dataset
    zip_path = _download(config.source_url, cache)
    if not extract_dir.exists():
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)

    corpus = _read_jsonl(_find(extract_dir, "corpus.jsonl"))
    queries = _read_jsonl(_find(extract_dir, "queries.jsonl"))
    qrels = _read_qrels(_find(extract_dir, f"{config.split}.tsv"))

    query_ids = [qid for qid in sorted(qrels) if qid in queries and qrels[qid]]
    if config.query_limit and config.query_limit > 0:
        query_ids = query_ids[:config.query_limit]
    relevant_ids = {docid for qid in query_ids for docid in qrels[qid]}

    corpus_ids = sorted(corpus)
    if config.corpus_limit and config.corpus_limit > 0:
        selected = set(sorted(relevant_ids))
        for docid in corpus_ids:
            if len(selected) >= config.corpus_limit:
                break
            selected.add(docid)
        corpus_ids = sorted(docid for docid in selected if docid in corpus)

    assets.mkdir(parents=True, exist_ok=True)
    id_to_filename: dict[str, str] = {}
    for docid in corpus_ids:
        row = corpus[docid]
        filename = _doc_filename(docid)
        id_to_filename[docid] = filename
        title = (row.get("title") or "").strip()
        text = (row.get("text") or "").strip()
        body = f"# {title}\n\n{text}\n" if title else f"{text}\n"
        (assets / filename).write_text(body, encoding="utf-8")

    cases = []
    for qid in query_ids:
        relevant = sorted(id_to_filename[d] for d in qrels[qid] if d in id_to_filename)
        if not relevant:
            continue
        cases.append({
            "id": f"{config.dataset}-{config.split}-{qid}",
            "query": queries[qid]["text"],
            "top_k": 10,
            "tags": ["beir", config.dataset, config.split],
            "relevant_documents": relevant,
            "key_facts": [],
        })

    suite = {
        "suite": config.suite,
        "owner_user_id": config.owner_user_id,
        "files_dir": str(assets),
        "documents": [id_to_filename[d] for d in corpus_ids],
        "thresholds": config.thresholds.model_dump(exclude_none=True),
        "cases": cases,
    }
    golden.parent.mkdir(parents=True, exist_ok=True)
    golden.write_text(yaml.safe_dump(suite, allow_unicode=True, sort_keys=False),
                      encoding="utf-8")
    return golden
