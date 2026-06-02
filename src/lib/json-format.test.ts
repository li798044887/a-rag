import { expect, test } from "vitest";
import { prettyJson, splitJsonl, tokenizeJson } from "@/lib/json-format";

test("prettyJson: 妥当な JSON を 2スペースで整形", () => {
  const r = prettyJson('{"a":1,"b":[true,null]}');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.text).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
});

test("prettyJson: 不正な JSON は ok:false", () => {
  expect(prettyJson("{not json}").ok).toBe(false);
});

test("tokenizeJson: キー/文字列/数値/真偽/null を分類", () => {
  const toks = tokenizeJson('{\n  "a": "x",\n  "b": 1,\n  "c": true,\n  "d": null\n}');
  const typed = toks.filter((t) => t.type !== "text");
  expect(typed).toEqual([
    { type: "key", value: '"a"' },
    { type: "string", value: '"x"' },
    { type: "key", value: '"b"' },
    { type: "number", value: "1" },
    { type: "key", value: '"c"' },
    { type: "boolean", value: "true" },
    { type: "key", value: '"d"' },
    { type: "null", value: "null" },
  ]);
});

test("tokenizeJson: 連結すると元の文字列に戻る", () => {
  const src = '{\n  "n": -2.5e3,\n  "s": "he said \\"hi\\""\n}';
  expect(tokenizeJson(src).map((t) => t.value).join("")).toBe(src);
});

test("splitJsonl: 空行を除いた行配列", () => {
  expect(splitJsonl('{"a":1}\n\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
});
