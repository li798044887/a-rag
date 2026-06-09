import { expect, test } from "vitest";
import {
  factGroupMatched,
  factCoverage,
  citationRecall,
  citationPrecision,
} from "./metrics.ts";

test("factGroupMatched は any のいずれかが回答に含まれれば true", () => {
  expect(factGroupMatched("バイパス弁 V-12 を点検", { any: ["V-12", "Ｖ-12"] })).toBe(true);
  // 全角表記でも、NFKC 正規化により半角 alias と一致する。
  expect(factGroupMatched("点検対象は Ｖ-12 です", { any: ["V-12", "Ｖ-12"] })).toBe(true);
  expect(factGroupMatched("該当なし", { any: ["V-12", "Ｖ-12"] })).toBe(false);
});

test("factCoverage は充足グループ比率と各グループの真偽を返す", () => {
  const groups = [{ any: ["N9"] }, { any: ["翌営業日AM", "翌営業日"] }, { any: ["0.91"] }];
  const r = factCoverage("コードN9。翌営業日に対応。", groups);
  expect(r.matched).toEqual([true, true, false]);
  expect(r.coverage).toBeCloseTo(2 / 3);
});

test("factCoverage はグループ空なら coverage=1", () => {
  expect(factCoverage("何でも", []).coverage).toBe(1);
});

test("citationRecall は関連文書のうち引用できた比率", () => {
  const cited = new Set(["A.pdf", "B.pdf"]);
  expect(citationRecall(cited, ["A.pdf", "C.pdf"])).toBeCloseTo(1 / 2);
  expect(citationRecall(cited, ["A.pdf", "B.pdf"])).toBe(1);
});

test("citationRecall は relevant 空なら 1", () => {
  expect(citationRecall(new Set(["A.pdf"]), [])).toBe(1);
});

test("citationPrecision は引用のうち関連文書だった比率（引用ゼロは 0）", () => {
  const cited = new Set(["A.pdf", "X.pdf"]);
  expect(citationPrecision(cited, ["A.pdf", "B.pdf"])).toBeCloseTo(1 / 2);
  expect(citationPrecision(new Set<string>(), ["A.pdf"])).toBe(0);
});

test("factGroupMatched は大小文字・全角半角を正規化して一致する（Python eval パリティ）", () => {
  // golden の英語ファクトは CamelCase だが、回答が小文字でも一致する。
  expect(factGroupMatched("原因は kafka consumer lag です", { any: ["Kafka consumer lag"] })).toBe(true);
  // 全角英数字も NFKC で半角化して一致する。
  expect(factGroupMatched("コードはＮ９でした", { any: ["N9"] })).toBe(true);
});
