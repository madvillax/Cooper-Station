import { describe, expect, it } from "vitest";
import { createGovernor, tierSettings, type Tier } from "./quality";

type Governor = ReturnType<typeof createGovernor>;

/** Feeds one sample per 60 Hz frame and returns every tier change. */
function feed(governor: Governor, load: number, fromMs: number, toMs: number) {
  const changes: Tier[] = [];
  for (let now = fromMs; now < toMs; now += 1000 / 60) {
    const change = governor.sample(load, now);
    if (change) changes.push(change);
  }
  return changes;
}

describe("quality governor", () => {
  it("steps down after two overloaded windows, not one", () => {
    const governor = createGovernor({ initial: "high", upThreshold: 0.5 });
    expect(feed(governor, 1.4, 0, 2100)).toEqual([]);
    expect(feed(governor, 1.4, 2100, 4200)).toEqual(["balanced"]);
    expect(governor.tier).toBe("balanced");
  });

  it("forgives a single bad window", () => {
    const governor = createGovernor({ initial: "high", upThreshold: 0.5 });
    feed(governor, 1.4, 0, 2100);
    expect(feed(governor, 0.8, 2100, 9000)).toEqual([]);
    expect(governor.tier).toBe("high");
  });

  it("ignores a window with too few samples", () => {
    const governor = createGovernor({ initial: "high", upThreshold: 0.5 });
    // A throttled tab: ten very slow frames across each window.
    for (let now = 0; now < 12000; now += 200) {
      expect(governor.sample(5, now)).toBeNull();
    }
    expect(governor.tier).toBe("high");
  });

  it("waits four seconds between changes", () => {
    const governor = createGovernor({ initial: "high", upThreshold: 0.5 });
    const changes = feed(governor, 1.4, 0, 8100);
    expect(changes).toEqual(["balanced", "low"]);
    const second = createGovernor({ initial: "high", upThreshold: 0.5 });
    expect(feed(second, 1.4, 0, 7900)).toEqual(["balanced"]);
  });

  it("steps up after five light windows", () => {
    const governor = createGovernor({ initial: "low", upThreshold: 0.5 });
    expect(feed(governor, 0.3, 0, 9900)).toEqual([]);
    expect(feed(governor, 0.3, 9900, 10200)).toEqual(["balanced"]);
  });

  it("does not step up when load sits above the up threshold", () => {
    const governor = createGovernor({ initial: "low", upThreshold: 0.5 });
    expect(feed(governor, 0.7, 0, 30000)).toEqual([]);
  });

  it("does not return to a tier it just left for sixty seconds", () => {
    const governor = createGovernor({ initial: "high", upThreshold: 0.5 });
    feed(governor, 1.4, 0, 4200);
    expect(governor.tier).toBe("balanced");
    expect(feed(governor, 0.2, 4200, 60000)).toEqual([]);
    expect(feed(governor, 0.2, 60000, 80000)).toEqual(["high"]);
  });

  it("starts over after discard", () => {
    const governor = createGovernor({ initial: "high", upThreshold: 0.5 });
    feed(governor, 1.4, 0, 2100);
    governor.discard();
    expect(feed(governor, 1.4, 2100, 4100)).toEqual([]);
    expect(feed(governor, 1.4, 4100, 6400)).toEqual(["balanced"]);
  });

  it("holds a pinned tier and reports the change once", () => {
    const governor = createGovernor({ initial: "high", upThreshold: 0.5 });
    expect(governor.pin("low")).toBe("low");
    expect(governor.pin("low")).toBeNull();
    expect(feed(governor, 0.1, 0, 30000)).toEqual([]);
    expect(governor.tier).toBe("low");
  });

  it("resumes automatic changes when unpinned", () => {
    const governor = createGovernor({ initial: "high", upThreshold: 0.5 });
    governor.pin("low");
    expect(governor.pin("auto")).toBeNull();
    expect(feed(governor, 0.1, 0, 10200)).toEqual(["balanced"]);
  });

  it("never goes below low or above high", () => {
    const low = createGovernor({ initial: "low", upThreshold: 0.5 });
    expect(feed(low, 3, 0, 20000)).toEqual([]);
    const high = createGovernor({ initial: "high", upThreshold: 0.5 });
    expect(feed(high, 0.1, 0, 20000)).toEqual([]);
  });
});

describe("tier settings", () => {
  it("never renders below six tenths of the device ratio", () => {
    for (const tier of Object.values(tierSettings)) {
      expect(tier.scale).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("keeps the low tier on the direct, non-HDR path", () => {
    expect(tierSettings.low.hdr).toBe(false);
    expect(tierSettings.low.bloom).toBe(false);
  });
});

import { createPacer } from "./quality";

describe("frame pacer", () => {
  const feedPacer = (pacer: ReturnType<typeof createPacer>, interval: number, frames: number) => {
    let behind = 1;
    for (let i = 0; i < frames; i++) behind = pacer.observe(interval);
    return behind;
  };

  it("reads a steady 60 Hz stream as keeping up", () => {
    expect(feedPacer(createPacer(), 16.67, 120)).toBeCloseTo(1, 1);
  });

  it("reads a steady 120 Hz stream as keeping up", () => {
    expect(feedPacer(createPacer(), 8.33, 240)).toBeCloseTo(1, 1);
  });

  it("is not fooled by one short gap between frames", () => {
    const pacer = createPacer();
    feedPacer(pacer, 16.67, 120);
    pacer.observe(3);
    expect(feedPacer(pacer, 16.67, 10)).toBeCloseTo(1, 1);
  });

  it("ignores a timestamp that runs backwards", () => {
    const pacer = createPacer();
    feedPacer(pacer, 16.67, 120);
    expect(pacer.observe(-900)).toBe(1);
    expect(feedPacer(pacer, 16.67, 10)).toBeCloseTo(1, 1);
  });

  it("reports half speed on a 60 Hz display as twice behind", () => {
    const pacer = createPacer();
    feedPacer(pacer, 16.67, 120);
    expect(feedPacer(pacer, 33.3, 60)).toBeCloseTo(2, 1);
  });

  it("assumes at least 60 Hz when it has only ever seen slow frames", () => {
    expect(feedPacer(createPacer(), 33.3, 300)).toBeCloseTo(2, 1);
  });

  it("notices a 120 Hz display dropping to 60", () => {
    const pacer = createPacer();
    feedPacer(pacer, 8.33, 240);
    expect(feedPacer(pacer, 16.67, 40)).toBeGreaterThan(1.5);
  });
});
