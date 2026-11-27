import { describe, expect, it } from "vitest";
import { stepSpring, type Spring } from "./spring";

function run(spring: Spring, target: number, halfLife: number, dt: number, steps: number) {
  let peak = spring.value;
  for (let i = 0; i < steps; i++) {
    stepSpring(spring, target, halfLife, dt);
    peak = Math.max(peak, spring.value);
  }
  return peak;
}

describe("critically damped spring", () => {
  it("converges on its target", () => {
    const spring = { value: 0, velocity: 0 };
    run(spring, 1, 0.1, 1 / 60, 600);
    expect(spring.value).toBeCloseTo(1, 4);
    expect(spring.velocity).toBeCloseTo(0, 4);
  });

  it("does not overshoot when starting at rest", () => {
    const peak = run({ value: 0, velocity: 0 }, 1, 0.1, 1 / 60, 600);
    expect(peak).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("gives the same answer whatever the frame rate", () => {
    const coarse = { value: 0, velocity: 2 };
    const fine = { value: 0, velocity: 2 };
    stepSpring(coarse, 1, 0.2, 0.1);
    run(fine, 1, 0.2, 0.01, 10);
    expect(coarse.value).toBeCloseTo(fine.value, 9);
    expect(coarse.velocity).toBeCloseTo(fine.velocity, 9);
  });

  it("carries momentum past the starting point", () => {
    const spring = { value: 0, velocity: 5 };
    stepSpring(spring, 0, 0.2, 0.05);
    expect(spring.value).toBeGreaterThan(0);
  });

  it("snaps when the half-life is zero", () => {
    const spring = { value: 0, velocity: 3 };
    stepSpring(spring, 7, 0, 1 / 60);
    expect(spring).toEqual({ value: 7, velocity: 0 });
  });

  it("changes nothing when no time passes", () => {
    const spring = { value: 2, velocity: 3 };
    stepSpring(spring, 9, 0.1, 0);
    expect(spring).toEqual({ value: 2, velocity: 3 });
  });
});
