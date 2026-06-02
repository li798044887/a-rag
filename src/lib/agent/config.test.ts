import { expect, test } from "vitest";
import { clampAgentCfg, buildSystemPrompt, AGENT_CFG_DEFAULTS } from "@/lib/agent/config";

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

test("buildSystemPrompt enforces citations when requireCitations is on", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, requireCitations: true });
  expect(p).toContain("必ず");
  expect(p).toContain("[1]");
});

test("buildSystemPrompt relaxes citations when off", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, requireCitations: false });
  expect(p).toContain("必須ではありません");
});

test("buildSystemPrompt includes the わからない clause when admitUnknown is on", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, admitUnknown: true });
  expect(p).toContain("わからない");
});

test("buildSystemPrompt omits the わからない clause when off", () => {
  const p = buildSystemPrompt({ ...AGENT_CFG_DEFAULTS, admitUnknown: false });
  expect(p).not.toContain("わからない");
});
