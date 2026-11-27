import { describe, expect, it } from "vitest";
import {
  DEFAULT_RPM,
  daysSinceJ2000,
  lightTimeSeconds,
  orbitAngle,
  rimGravity,
  rimSpeed,
  timeDilation,
} from "./physics";

describe("rim gravity", () => {
  it("produces approximately Earth gravity at the default spin", () => {
    expect(rimGravity(DEFAULT_RPM)).toBeCloseTo(1.005, 2);
  });

  it("disappears at rest and grows with the square of the spin rate", () => {
    expect(rimGravity(0)).toBe(0);
    expect(rimGravity(0.6)).toBeCloseTo(rimGravity(0.3) * 4);
  });
});

describe("rim speed", () => {
  it("is the tangential speed of the habitat floor", () => {
    expect(rimSpeed(DEFAULT_RPM)).toBeCloseTo(177.6, 1);
    expect(rimSpeed(0)).toBe(0);
  });
});

describe("time dilation of a static observer", () => {
  it("runs at the far-away rate at infinity", () => {
    expect(timeDilation(Infinity)).toBe(1);
  });

  it("slows as the observer approaches the horizon", () => {
    expect(timeDilation(4)).toBeCloseTo(0.866, 4);
    expect(timeDilation(2)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("stops at the horizon and stays stopped inside it", () => {
    expect(timeDilation(1)).toBe(0);
    expect(timeDilation(0.5)).toBe(0);
  });
});

describe("light time", () => {
  it("takes about 499 seconds to cross one astronomical unit", () => {
    expect(lightTimeSeconds(1)).toBeCloseTo(499.0, 1);
    expect(lightTimeSeconds(0)).toBe(0);
  });
});

describe("simulation date", () => {
  it("counts days from the J2000 epoch", () => {
    expect(daysSinceJ2000(new Date("2000-01-01T12:00:00Z"))).toBe(0);
    expect(daysSinceJ2000(new Date("2000-01-02T12:00:00Z"))).toBe(1);
    expect(daysSinceJ2000(new Date("1999-12-31T12:00:00Z"))).toBe(-1);
  });
});

describe("orbit angle", () => {
  it("advances a quarter turn in a quarter period", () => {
    expect(orbitAngle(0, 360, 90)).toBeCloseTo(Math.PI / 2);
  });

  it("wraps into one turn", () => {
    expect(orbitAngle(350, 360, 20)).toBeCloseTo((10 * Math.PI) / 180);
    expect(orbitAngle(10, 360, -20)).toBeCloseTo((350 * Math.PI) / 180);
  });
});
