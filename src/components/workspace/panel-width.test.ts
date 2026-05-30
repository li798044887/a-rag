import { describe, expect, it } from "vitest";
import { clampPanelWidth, RP_WIDTH_DEFAULT, RP_WIDTH_MIN } from "@/components/workspace/panel-width";

describe("clampPanelWidth", () => {
  it("範囲内はそのまま（小数は丸める）", () => {
    expect(clampPanelWidth(500.4, 2000)).toBe(500);
  });

  it("最小値未満は最小値に丸める", () => {
    expect(clampPanelWidth(100, 2000)).toBe(RP_WIDTH_MIN);
  });

  it("最大値超は最大値(720)に丸める", () => {
    expect(clampPanelWidth(900, 2000)).toBe(720);
  });

  it("狭いビューポートでは 50% で頭打ち", () => {
    expect(clampPanelWidth(500, 800)).toBe(400);
  });

  it("ビューポートが極端に狭く上限<下限なら上限を優先", () => {
    expect(clampPanelWidth(500, 600)).toBe(300);
  });

  it("既定値は 420", () => {
    expect(RP_WIDTH_DEFAULT).toBe(420);
  });
});
