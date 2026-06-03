import { describe, it, expect, vi } from "vitest";
import { persistAndSwitchLocale } from "./use-locale-switch";

describe("persistAndSwitchLocale", () => {
  it("先持久化语言再触发 reload", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    await persistAndSwitchLocale("ja", { save, reload });
    expect(save).toHaveBeenCalledWith("ja");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("持久化失败时不 reload", async () => {
    const save = vi.fn().mockRejectedValue(new Error("boom"));
    const reload = vi.fn();
    await expect(persistAndSwitchLocale("zh", { save, reload })).rejects.toThrow("boom");
    expect(reload).not.toHaveBeenCalled();
  });
});
