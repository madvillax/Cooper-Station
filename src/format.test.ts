import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("shows the two largest units", () => {
    expect(formatDuration(59)).toBe("59 s");
    expect(formatDuration(499)).toBe("8 m 19 s");
    expect(formatDuration(4800)).toBe("1 h 20 m");
    expect(formatDuration(86400 * 3.5)).toBe("3 d 12 h");
  });

  it("drops a zero second unit", () => {
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(120)).toBe("2 m");
  });

  it("switches to years for long spans", () => {
    expect(formatDuration(86400 * 365.25 * 29.5)).toBe("29.5 y");
  });

  it("treats negative and zero spans as zero", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(-5)).toBe("0 s");
  });
});
