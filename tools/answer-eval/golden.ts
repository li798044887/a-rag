/** golden.yaml（Python eval と共有）と answer.yaml（answer-eval 専用）のローダと型。 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface FactGroup { any: string[]; }
export interface GoldenCase {
  id: string;
  query: string;
  top_k?: number;
  relevant_documents: string[];
  key_facts: FactGroup[];
}
export interface Golden { suite: string; owner_user_id: string; cases: GoldenCase[]; }

export interface Thresholds {
  citation_recall: number;
  citation_precision: number;
  answer_fact_coverage: number;
}
export interface AnswerConfig { primary: string; models: string[]; thresholds: Thresholds; }

export interface CaseMetrics {
  citation_recall: number;
  citation_precision: number;
  answer_fact_coverage: number;
}

/** リポジトリ root から suite ディレクトリの絶対パスを返す。 */
export function suiteDir(repoRoot: string, suite: string): string {
  return join(repoRoot, "rag", "eval", "suites", suite);
}

/** golden.yaml をファイルパス直指定で読む（beir/hotpot は生成 golden を host へコピーして渡す）。 */
export function loadGoldenFile(file: string): Golden {
  return parse(readFileSync(file, "utf8")) as Golden;
}

export function loadGolden(dir: string): Golden {
  return loadGoldenFile(join(dir, "golden.yaml"));
}

export function loadAnswerConfig(dir: string): AnswerConfig {
  const raw = parse(readFileSync(join(dir, "answer.yaml"), "utf8")) as AnswerConfig;
  return raw;
}
