import { describe, expect, it } from "vitest";
import { computeOverflow } from "@/components/sources/use-overflow";

describe("computeOverflow", () => {
  it("はみ出しが無ければ両方 false", () => {
    expect(computeOverflow({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({ left: false, right: false });
  });

  it("先頭ではみ出しがあれば right のみ true", () => {
    expect(computeOverflow({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 })).toEqual({ left: false, right: true });
  });

  it("中間までスクロールすると両側 true", () => {
    expect(computeOverflow({ scrollLeft: 100, scrollWidth: 500, clientWidth: 300 })).toEqual({ left: true, right: true });
  });

  it("末尾までスクロールすると left のみ true", () => {
    expect(computeOverflow({ scrollLeft: 200, scrollWidth: 500, clientWidth: 300 })).toEqual({ left: true, right: false });
  });

  it("1px 未満の端数は許容する", () => {
    expect(computeOverflow({ scrollLeft: 0.5, scrollWidth: 300.4, clientWidth: 300 })).toEqual({ left: false, right: false });
  });
});
