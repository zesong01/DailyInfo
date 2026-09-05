import { describe, expect, it } from "vitest";
import {
  correlation,
  parseQuote,
  performance,
  quoteTimeBjt,
  safeUrl,
} from "./domain";
import { validEndpoint } from "./api";

describe("market data integrity", () => {
  it("rejects empty, malformed and zero reference prices", () => {
    expect(parseQuote("QQQ", "")).toBeNull();
    const f = Array(50).fill("");
    f[3] = "100";
    f[4] = "0";
    expect(parseQuote("QQQ", f.join("~"))).toBeNull();
  });
  it("computes quote change from actual previous close", () => {
    const f = Array(50).fill("");
    f[3] = "105";
    f[4] = "100";
    f[30] = "20260904150000";
    const q = parseQuote("510300", f.join("~"))!;
    expect(q.changePercent).toBeCloseTo(5);
    expect(q.time).toBe("2026-09-04 15:00:00");
  });
  it("converts New York summer and winter close into Beijing time", () => {
    expect(quoteTimeBjt("2026-09-04 16:00:01", "US")).toContain("04:00");
    expect(quoteTimeBjt("2026-01-05 16:00:01", "US")).toContain("05:00");
    expect(quoteTimeBjt("2026-09-04 15:00:00", "CN")).toBe(
      "2026-09-04 15:00:00",
    );
    expect(quoteTimeBjt(undefined, "US")).toBe("暂无报价");
  });
  it("calculates peak-to-trough drawdown rather than ending loss", () => {
    const p = [100, 120, 90, 110].map((close, i) => ({
      date: String(i),
      close,
    }));
    const stats = performance(p)!;
    expect(stats.change).toBeCloseTo(10);
    expect(stats.drawdown).toBeCloseTo(-25);
    expect(stats.volatility).toBeGreaterThan(0);
  });
  it("does not invent metrics when history is missing", () => {
    expect(performance([])).toBeNull();
    expect(performance([{ date: "a", close: 1 }])).toBeNull();
    expect(
      performance([
        { date: "a", close: 1 },
        { date: "b", close: 2 },
      ])?.volatility,
    ).toBeNull();
  });
  it("aligns common trading dates before computing return correlation", () => {
    const a = Array.from({ length: 30 }, (_, i) => ({
      date: `day-${i}`,
      close: 100 + i + Math.sin(i) * 2,
    }));
    const b = a
      .filter((_, i) => i !== 10)
      .map((p) => ({ ...p, close: p.close * 3 }));
    expect(correlation(a, b)?.value).toBeCloseTo(1);
    expect(correlation(a, b)?.count).toBe(28);
    expect(correlation(a, b.slice(0, 10))).toBeNull();
  });
});
describe("untrusted URLs and credential endpoints", () => {
  it("rejects executable and malformed source links", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("not a url")).toBe("#");
    expect(safeUrl("https://arxiv.org/abs/1")).toBe("https://arxiv.org/abs/1");
  });
  it("keeps credentials on TLS or explicit local development hosts", () => {
    expect(validEndpoint("https://api.deepseek.com/")).toBe(
      "https://api.deepseek.com",
    );
    expect(validEndpoint("http://localhost:8080/v1")).toBe(
      "http://localhost:8080/v1",
    );
    expect(() => validEndpoint("http://example.com")).toThrow();
    expect(() => validEndpoint("https://user:secret@example.com")).toThrow();
    expect(() => validEndpoint("https://example.com?key=abc")).toThrow();
  });
});
