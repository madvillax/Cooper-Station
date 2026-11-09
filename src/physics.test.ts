import { describe, expect, it } from "vitest";
import { DEFAULT_RPM, rimGravity } from "./physics";

describe("rim gravity", () => {
  it("produces approximately Earth gravity at the default spin", () => {
    expect(rimGravity(DEFAULT_RPM)).toBeCloseTo(1.005, 2);
  });

  it("disappears at rest and grows with the square of the spin rate", () => {
    expect(rimGravity(0)).toBe(0);
    expect(rimGravity(0.6)).toBeCloseTo(rimGravity(0.3) * 4);
  });
});
