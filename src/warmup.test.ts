import { afterEach, describe, expect, it, vi } from "vitest";
import { runStages, warmOrder, type Stage } from "./warmup";

afterEach(() => vi.unstubAllGlobals());

describe("runStages", () => {
  it("runs stages in order and reports weighted progress", async () => {
    const ran: string[] = [];
    const progress: [number, string][] = [];
    const stages: Stage[] = [
      { label: "a", weight: 1, run: () => void ran.push("a") },
      { label: "b", weight: 3, run: async () => void ran.push("b") },
    ];
    await runStages(stages, (fraction, label) => progress.push([fraction, label]));
    expect(ran).toEqual(["a", "b"]);
    expect(progress).toEqual([
      [0, "a"],
      [0.25, "b"],
      [1, "b"],
    ]);
  });

  it("pauses between stages so the page can paint", async () => {
    const order: string[] = [];
    const stages: Stage[] = [
      { label: "a", weight: 1, run: () => void order.push("a") },
      { label: "b", weight: 1, run: () => void order.push("b") },
    ];
    await runStages(
      stages,
      () => {},
      async () => void order.push("pause"),
    );
    expect(order).toEqual(["a", "pause", "b", "pause"]);
  });

  it("finishes without animation frames, as in a hidden tab", async () => {
    vi.stubGlobal("requestAnimationFrame", () => {
      throw new Error("animation frames are paused");
    });
    const ran: string[] = [];
    await runStages(
      [
        { label: "a", weight: 1, run: () => void ran.push("a") },
        { label: "b", weight: 1, run: () => void ran.push("b") },
      ],
      () => {},
    );
    expect(ran).toEqual(["a", "b"]);
  });

  it("skips a failing optional stage and still reaches the end", async () => {
    const progress: number[] = [];
    const ran: string[] = [];
    await runStages(
      [
        {
          label: "texture",
          weight: 1,
          optional: true,
          run: () => Promise.reject(new Error("404")),
        },
        { label: "build", weight: 1, run: () => void ran.push("build") },
      ],
      (fraction) => progress.push(fraction),
    );
    expect(ran).toEqual(["build"]);
    expect(progress.at(-1)).toBe(1);
  });

  it("rejects when a required stage fails", async () => {
    await expect(
      runStages(
        [
          {
            label: "build",
            weight: 1,
            run: () => {
              throw new Error("no WebGL");
            },
          },
        ],
        () => {},
      ),
    ).rejects.toThrow("no WebGL");
  });

  it("reports completion for an empty list", async () => {
    const progress: number[] = [];
    await runStages([], (fraction) => progress.push(fraction));
    expect(progress).toEqual([1]);
  });
});

describe("warmOrder", () => {
  it("warms the linked destination's group first", () => {
    expect(warmOrder("blackhole")).toEqual([
      "blackhole",
      "station",
      "system",
      "galaxy",
    ]);
    expect(warmOrder("earth")[0]).toBe("system");
    expect(warmOrder("galaxy")[0]).toBe("galaxy");
  });

  it("keeps the default order for the station", () => {
    expect(warmOrder("station")).toEqual([
      "station",
      "system",
      "galaxy",
      "blackhole",
    ]);
  });

  it("lists every group exactly once", () => {
    expect([...warmOrder("sun")].sort()).toEqual([
      "blackhole",
      "galaxy",
      "station",
      "system",
    ]);
  });
});
