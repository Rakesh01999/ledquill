import { describe, expect, it } from "vitest";
import { addDays, bucketEnd, bucketHref, dashboardHref, listHref, parseRange, pct, periodLabel, rangeText } from "./dashboard";

const sp = (q: string) => new URLSearchParams(q);
const TODAY = new Date(2026, 10, 26); // 26 Nov 2026, local

describe("dashboard date range in the URL", () => {
  it("is all time when the URL says nothing", () => {
    expect(parseRange(sp(""), TODAY)).toEqual({ preset: "all" });
    expect(parseRange(sp("range=bogus"), TODAY)).toEqual({ preset: "all" });
  });

  it("resolves presets against today, both ends included", () => {
    expect(parseRange(sp("range=30d"), TODAY)).toEqual({ preset: "30d", date_from: "2026-10-28", date_to: "2026-11-26" });
    expect(parseRange(sp("range=90d"), TODAY)).toMatchObject({ date_from: "2026-08-29", date_to: "2026-11-26" });
    expect(parseRange(sp("range=12m"), TODAY)).toMatchObject({ date_from: "2025-11-27", date_to: "2026-11-26" });
  });

  it("reads a custom range, one-sided too, and ignores bad or reversed dates", () => {
    expect(parseRange(sp("from=2026-01-01&to=2026-03-31"), TODAY)).toEqual({
      preset: "custom",
      date_from: "2026-01-01",
      date_to: "2026-03-31",
    });
    expect(parseRange(sp("from=2026-01-01"), TODAY)).toEqual({ preset: "custom", date_from: "2026-01-01", date_to: undefined });
    expect(parseRange(sp("from=2026-03-31&to=2026-01-01"), TODAY)).toEqual({ preset: "all" });
    expect(parseRange(sp("from=yesterday"), TODAY)).toEqual({ preset: "all" });
  });

  it("round-trips through the URL", () => {
    for (const q of ["", "range=90d", "from=2026-01-01&to=2026-03-31"]) {
      const range = parseRange(sp(q), TODAY);
      expect(parseRange(sp(dashboardHref(range).split("?")[1] ?? ""), TODAY)).toEqual(range);
    }
  });
});

describe("drill-down links", () => {
  const range = { preset: "custom" as const, date_from: "2026-01-01", date_to: "2026-03-31" };

  it("carries the range and the slice into the Invoices list URL", () => {
    expect(listHref({ status: "ready" }, range)).toBe("/invoices?status=ready&date_from=2026-01-01&date_to=2026-03-31");
    expect(listHref({ supplier: ["Acme Ltd"], currency: ["USD"] }, { preset: "all" })).toBe(
      "/invoices?supplier=Acme+Ltd&currency=USD",
    );
  });

  it("finds the last day of a day, week and month bucket", () => {
    expect(bucketEnd("2026-02-10", "day")).toBe("2026-02-10");
    expect(bucketEnd("2026-02-09", "week")).toBe("2026-02-15");
    expect(bucketEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(bucketEnd("2024-02-01", "month")).toBe("2024-02-29");
    expect(bucketEnd("2026-12-01", "month")).toBe("2026-12-31");
  });

  it("clamps a bar's days to the range so the list matches the bar", () => {
    // The first week starts before the range, the last month ends after it.
    expect(bucketHref("2025-12-29", "week", range)).toBe("/invoices?date_from=2026-01-01&date_to=2026-01-04");
    expect(bucketHref("2026-03-01", "month", { ...range, date_to: "2026-03-15" })).toBe(
      "/invoices?date_from=2026-03-01&date_to=2026-03-15",
    );
    expect(bucketHref("2026-02-01", "month", { preset: "all" })).toBe("/invoices?date_from=2026-02-01&date_to=2026-02-28");
  });
});

describe("labels", () => {
  it("describes buckets and ranges in words", () => {
    expect(periodLabel("2026-03-01", "month")).toEqual({ short: "Mar 26", full: "Mar 2026" });
    expect(periodLabel("2026-03-02", "week").full).toBe("Week of 2 Mar 2026");
    expect(rangeText({ preset: "all" })).toBe("all time");
    expect(rangeText({ preset: "30d" })).toBe("last 30 days");
    expect(rangeText({ preset: "custom", date_from: "2026-01-01", date_to: "2026-03-31" })).toBe("1 Jan 2026 to 31 Mar 2026");
  });

  it("does arithmetic on dates without a time zone", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(pct(1, 3)).toBe("33%");
    expect(pct(0, 0)).toBe("0%");
  });
});
