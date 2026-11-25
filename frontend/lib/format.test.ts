import { expect, test } from "vitest";
import { formatDecimal, formatQuantity } from "./format";

test("zero is a value, not a missing value", () => {
  expect(formatQuantity("0")).toBe("0");
  expect(formatQuantity("0.0000")).toBe("0");
  expect(formatDecimal("0")).toBe("0.00");
  expect(formatDecimal("0.00")).toBe("0.00");
});

test("whole and decimal quantities keep what the document printed", () => {
  expect(formatQuantity("20")).toBe("20");
  expect(formatQuantity("2.0000")).toBe("2");
  expect(formatQuantity("2.5")).toBe("2.5");
  expect(formatQuantity("1500")).toBe("1,500");
});

test("only null, undefined and unparseable values are missing", () => {
  expect(formatQuantity(null)).toBeNull();
  expect(formatQuantity(undefined)).toBeNull();
  expect(formatDecimal(null)).toBeNull();
  expect(formatDecimal(undefined)).toBeNull();
  expect(formatDecimal("")).toBeNull();
  expect(formatDecimal("abc")).toBeNull();
});

test("money is grouped and padded as text, never rounded", () => {
  expect(formatDecimal("1150")).toBe("1,150.00");
  expect(formatDecimal("-1234567.5")).toBe("-1,234,567.50");
  expect(formatDecimal("0.125")).toBe("0.125");
  expect(formatDecimal("99.0000")).toBe("99.00");
  expect(formatDecimal("2970.5000")).toBe("2,970.50");
});
