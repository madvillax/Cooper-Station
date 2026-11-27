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

import { formatDate, formatDilation, formatRate } from "./format";

describe("formatRate", () => {
  it("names real time and the steps above it", () => {
    expect(formatRate(1)).toBe("Real time");
    expect(formatRate(600)).toBe("10 min/s");
    expect(formatRate(3600)).toBe("1 hour/s");
    expect(formatRate(86_400)).toBe("1 day/s");
    expect(formatRate(864_000)).toBe("10 days/s");
  });

  it("shows multiples of real time for small rates", () => {
    expect(formatRate(5)).toBe("5×");
    expect(formatRate(15)).toBe("15×");
  });
});

describe("formatDate", () => {
  it("reads days since J2000 as a calendar date", () => {
    expect(formatDate(0)).toBe("1 Jan 2000");
    expect(formatDate(366)).toBe("1 Jan 2001");
    expect(formatDate(-0.75)).toBe("31 Dec 1999");
  });
});

describe("formatDilation", () => {
  it("says how much time passes far away for an hour here", () => {
    expect(formatDilation(0.866)).toBe("1 h here = 1 h 09 m far away");
    expect(formatDilation(0.5)).toBe("1 h here = 2 h 00 m far away");
    expect(formatDilation(1)).toBe("1 h here = 1 h 00 m far away");
  });

  it("handles the horizon", () => {
    expect(formatDilation(0)).toBe("Time stops");
  });

  it("switches to days when the gap is large", () => {
    expect(formatDilation(0.01)).toBe("1 h here = 4.2 d far away");
  });
});
