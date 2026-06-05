from pathlib import Path

import yaml
from pydantic import BaseModel, model_validator


class KeyFact(BaseModel):
    any: list[str]  # いずれか1つが top-k 本文に出現すれば充足


class Case(BaseModel):
    id: str
    query: str
    rewritten: str | None = None
    top_k: int = 6
    relevant_documents: list[str] = []
    key_facts: list[KeyFact] = []


class Thresholds(BaseModel):
    recall_at_5: float | None = None
    fact_coverage: float | None = None


class GoldenSuite(BaseModel):
    suite: str
    owner_user_id: str
    documents: list[str]
    thresholds: Thresholds = Thresholds()
    cases: list[Case]

    @model_validator(mode="after")
    def _check_relevant_subset(self) -> "GoldenSuite":
        known = set(self.documents)
        for case in self.cases:
            for fn in case.relevant_documents:
                if fn not in known:
                    raise ValueError(
                        f"case {case.id}: relevant_documents に未登録の {fn} があります")
        return self


def load_suite(path: str | Path) -> GoldenSuite:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return GoldenSuite.model_validate(data)
