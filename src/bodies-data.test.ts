import { describe, expect, it } from "vitest";
import {
  facts,
  orbital,
  overviewSize,
  radiusKm,
  rotationHours,
  timeRates,
} from "./bodies-data";
import { destinationGroups } from "./destinations";

describe("overview sizes", () => {
  it("keeps the real order of the bodies", () => {
    const order = [
      "sun",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
      "earth",
      "venus",
      "mars",
      "mercury",
    ] as const;
    const sizes = order.map((id) => overviewSize(radiusKm[id]));
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it("compresses the range so small planets stay visible", () => {
    const sun = overviewSize(radiusKm.sun);
    const mercury = overviewSize(radiusKm.mercury);
    expect(sun / mercury).toBeLessThan(20);
    expect(sun / mercury).toBeGreaterThan(5);
  });
});

describe("orbital data", () => {
  it("gives Earth one astronomical unit and a sidereal year", () => {
    expect(orbital.earth.au).toBe(1);
    expect(orbital.earth.periodDays).toBeCloseTo(365.256, 3);
  });

  it("orders the planets outward with longer years", () => {
    const planets = Object.values(orbital);
    for (let i = 1; i < planets.length; i++) {
      expect(planets[i].au).toBeGreaterThan(planets[i - 1].au);
      expect(planets[i].periodDays).toBeGreaterThan(planets[i - 1].periodDays);
    }
  });

  it("follows Kepler's third law to within one percent", () => {
    for (const planet of Object.values(orbital)) {
      const years = planet.periodDays / 365.256;
      expect(years ** 2 / planet.au ** 3).toBeCloseTo(1, 1);
    }
  });

  it("turns Earth once a sidereal day and Venus backwards", () => {
    expect(rotationHours.earth).toBeCloseTo(23.934, 2);
    expect(rotationHours.venus).toBeLessThan(0);
    expect(rotationHours.uranus).toBeLessThan(0);
  });
});

describe("facts", () => {
  it("has a summary and at least three rows for every destination", () => {
    for (const { ids } of destinationGroups) {
      for (const id of ids) {
        const card = facts(id);
        expect(card.summary.length, id).toBeGreaterThan(5);
        expect(card.rows.length, id).toBeGreaterThanOrEqual(3);
        for (const row of card.rows) {
          expect(row.label.length, id).toBeGreaterThan(0);
          expect(row.value.length, id).toBeGreaterThan(0);
        }
      }
    }
  });

  it("derives light time from distance", () => {
    const row = facts("earth").rows.find((entry) => entry.label === "Light time");
    expect(row?.value).toBe("8 m 19 s");
  });
});

describe("time rates", () => {
  it("lists solar rates in increasing order with real time first", () => {
    expect(timeRates.solar[0]).toBe(1);
    expect([...timeRates.solar].sort((a, b) => a - b)).toEqual(timeRates.solar);
    expect(timeRates.station).toEqual([1, 5, 15]);
  });
});
