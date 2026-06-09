import { expect, test } from "vitest";
import { clampAgentCfg, buildSystemPrompt, buildTemporalPromptContext, AGENT_CFG_DEFAULTS } from "@/lib/agent/config";

test("clampAgentCfg returns defaults for null / non-object", () => {
  expect(clampAgentCfg(null)).toEqual(AGENT_CFG_DEFAULTS);
  expect(clampAgentCfg(undefined)).toEqual(AGENT_CFG_DEFAULTS);
  expect(clampAgentCfg(42)).toEqual(AGENT_CFG_DEFAULTS);
  expect(clampAgentCfg([])).toEqual(AGENT_CFG_DEFAULTS);
});

test("clampAgentCfg clamps numbers into range and rounds", () => {
  expect(clampAgentCfg({ maxSteps: 0 }).maxSteps).toBe(1);
  expect(clampAgentCfg({ maxSteps: 100 }).maxSteps).toBe(20);
  expect(clampAgentCfg({ maxSteps: 7.6 }).maxSteps).toBe(8);
  expect(clampAgentCfg({ parallelTools: 0 }).parallelTools).toBe(1);
  expect(clampAgentCfg({ parallelTools: 99 }).parallelTools).toBe(8);
});

test("clampAgentCfg coerces numeric strings and falls back on NaN", () => {
  expect(clampAgentCfg({ maxSteps: "5" }).maxSteps).toBe(5);
  expect(clampAgentCfg({ maxSteps: "abc" }).maxSteps).toBe(AGENT_CFG_DEFAULTS.maxSteps);
});

test("clampAgentCfg fills missing booleans with defaults", () => {
  const c = clampAgentCfg({ maxSteps: 5 });
  expect(c.requireCitations).toBe(AGENT_CFG_DEFAULTS.requireCitations);
  expect(c.admitUnknown).toBe(AGENT_CFG_DEFAULTS.admitUnknown);
});

test("clampAgentCfg keeps explicit boolean values", () => {
  expect(clampAgentCfg({ requireCitations: false }).requireCitations).toBe(false);
  expect(clampAgentCfg({ admitUnknown: false }).admitUnknown).toBe(false);
});

test("clampAgentCfg multiHop defaults to false and keeps explicit value", () => {
  expect(AGENT_CFG_DEFAULTS.multiHop).toBe(false);
  expect(clampAgentCfg({ maxSteps: 5 }).multiHop).toBe(false);
  expect(clampAgentCfg({ multiHop: true }).multiHop).toBe(true);
});

test("clampAgentCfg clamps topK / candidateK into range", () => {
  expect(clampAgentCfg({ topK: 0 }).topK).toBe(1);
  expect(clampAgentCfg({ topK: 100 }).topK).toBe(20);
  // candidateK: 0 → clamp で 1、ただし topK デフォルト(6) >= 1 なので candidateK は 6 になる
  expect(clampAgentCfg({ candidateK: 0 }).candidateK).toBe(AGENT_CFG_DEFAULTS.topK);
  expect(clampAgentCfg({ candidateK: 999 }).candidateK).toBe(50);
  expect(clampAgentCfg({ topK: "abc" }).topK).toBe(AGENT_CFG_DEFAULTS.topK);
});

test("clampAgentCfg は candidateK を topK 以上へ引き上げる", () => {
  // candidateK(3) < topK(8) のとき candidateK は topK まで引き上げられる
  expect(clampAgentCfg({ topK: 8, candidateK: 3 }).candidateK).toBe(8);
  // candidateK が十分大きければそのまま
  expect(clampAgentCfg({ topK: 6, candidateK: 20 }).candidateK).toBe(20);
});

test("buildSystemPrompt enforces citations when requireCitations is on", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, requireCitations: true }, "ja");
  expect(p).toContain("必ず");
  expect(p).toContain("[1]");
});

test("buildSystemPrompt includes current temporal context for relative dates", () => {
  const p = buildSystemPrompt(
    AGENT_CFG_DEFAULTS,
    "zh",
    new Date("2026-06-04T02:30:00.000Z"),
    "Asia/Shanghai",
  );
  expect(p).toContain("当前日期时间");
  expect(p).toContain("今天=2026-06-04");
  expect(p).toContain("昨天=2026-06-03");
  expect(p).toContain("不要只把相对词作为检索词");
});

test("buildTemporalPromptContext calculates calendar dates in the specified timezone", () => {
  const context = buildTemporalPromptContext(new Date("2026-06-03T16:30:00.000Z"), "Asia/Tokyo");
  expect(context.nowDate).toBe("2026-06-04");
  expect(context.today).toBe("2026-06-04");
  expect(context.yesterday).toBe("2026-06-03");
  expect(context.tomorrow).toBe("2026-06-05");
  expect(context.nowTime).toBe("01:30:00");
});

test("buildSystemPrompt relaxes citations when off", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, requireCitations: false }, "ja");
  expect(p).toContain("必須ではありません");
});

test("buildSystemPrompt includes the わからない clause when admitUnknown is on", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, admitUnknown: true }, "ja");
  expect(p).toContain("わからない");
});

test("buildSystemPrompt omits the わからない clause when off", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, admitUnknown: false }, "ja");
  expect(p).not.toContain("わからない");
});

test("buildSystemPrompt は locale=zh で中国語プロンプトを返す", () => {
  const p = buildSystemPrompt(AGENT_CFG_DEFAULTS, "zh");
  expect(p).toContain("中文");
  expect(p).toContain("出处");
  expect(p).not.toContain("ください");
});

test("clampAgentCfg は新フィールドの既定値を埋める", () => {
  const cfg = clampAgentCfg({});
  expect(cfg.maxRetrieveRetries).toBe(AGENT_CFG_DEFAULTS.maxRetrieveRetries);
  expect(cfg.gradeThreshold).toBe(AGENT_CFG_DEFAULTS.gradeThreshold);
  expect(cfg.maxRevisions).toBe(AGENT_CFG_DEFAULTS.maxRevisions);
  expect(cfg.verify).toBe(AGENT_CFG_DEFAULTS.verify);
});

test("clampAgentCfg は範囲外の新フィールドを丸める", () => {
  const cfg = clampAgentCfg({ maxRetrieveRetries: 9, gradeThreshold: 5, maxRevisions: 9, verify: false });
  expect(cfg.maxRetrieveRetries).toBe(2);
  expect(cfg.gradeThreshold).toBeLessThanOrEqual(1);
  expect(cfg.gradeThreshold).toBeGreaterThanOrEqual(0);
  expect(cfg.maxRevisions).toBe(1);
  expect(cfg.verify).toBe(false);
});

test("clampAgentCfg は負値の retries/revisions を 0 に丸める", () => {
  const cfg = clampAgentCfg({ maxRetrieveRetries: -3, maxRevisions: -1 });
  expect(cfg.maxRetrieveRetries).toBe(0);
  expect(cfg.maxRevisions).toBe(0);
});
