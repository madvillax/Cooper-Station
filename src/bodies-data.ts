import type { Destination, PlanetId } from "./destinations";
import { formatDuration } from "./format";
import { lightTimeSeconds } from "./physics";

export type BodyId = PlanetId | "sun" | "moon";

/**
 * Semi-major axis, sidereal period and mean longitude at the J2000 epoch.
 * Source: NASA planetary fact sheets and JPL's approximate Keplerian elements.
 * The simulation treats every orbit as a circle in one plane, so positions are
 * right to within a few degrees for the inner planets, not exact.
 */
export const orbital: Record<
  PlanetId,
  { au: number; periodDays: number; meanLongitudeDeg: number }
> = {
  mercury: { au: 0.387, periodDays: 87.969, meanLongitudeDeg: 252.25 },
  venus: { au: 0.723, periodDays: 224.701, meanLongitudeDeg: 181.98 },
  earth: { au: 1, periodDays: 365.256, meanLongitudeDeg: 100.46 },
  mars: { au: 1.524, periodDays: 686.98, meanLongitudeDeg: 355.45 },
  jupiter: { au: 5.204, periodDays: 4332.589, meanLongitudeDeg: 34.4 },
  saturn: { au: 9.573, periodDays: 10759.22, meanLongitudeDeg: 49.95 },
  uranus: { au: 19.165, periodDays: 30685.4, meanLongitudeDeg: 313.24 },
  neptune: { au: 30.178, periodDays: 60189, meanLongitudeDeg: 304.88 },
};

/** Sidereal rotation period in hours; negative means it spins backwards. */
export const rotationHours: Record<BodyId, number> = {
  sun: 609.12,
  mercury: 1407.6,
  venus: -5832.5,
  earth: 23.9345,
  moon: 655.72,
  mars: 24.6229,
  jupiter: 9.925,
  saturn: 10.656,
  uranus: -17.24,
  neptune: 16.11,
};

/** Volumetric mean radius in kilometres. */
export const radiusKm: Record<BodyId, number> = {
  sun: 695_700,
  mercury: 2439.7,
  venus: 6051.8,
  earth: 6371,
  moon: 1737.4,
  mars: 3389.5,
  jupiter: 69_911,
  saturn: 58_232,
  uranus: 25_362,
  neptune: 24_622,
};

/** The Moon's sidereal month, in days. */
export const MOON_PERIOD_DAYS = 27.3217;

/**
 * Size of a body in the Solar System overview, in scene units. True sizes span
 * a factor of 285, which would leave the inner planets as single pixels, so the
 * range is compressed with a power law. The order of sizes stays true.
 */
export function overviewSize(km: number) {
  return 0.36 * (km / radiusKm.earth) ** 0.45;
}

/** Seconds of simulated time per real second. */
export const timeRates = {
  /** Multiples of real time for the station's spin. */
  station: [1, 5, 15],
  /** Real time, 10 minutes, 1 hour, 1 day and 10 days per second. */
  solar: [1, 600, 3600, 86_400, 864_000],
};
export const DEFAULT_SOLAR_RATE = 1;

export type Facts = { summary: string; rows: { label: string; value: string }[] };

const gravity: Record<PlanetId, number> = {
  mercury: 0.38,
  venus: 0.9,
  earth: 1,
  mars: 0.38,
  jupiter: 2.53,
  saturn: 1.06,
  uranus: 0.9,
  neptune: 1.14,
};

const planetSummary: Record<PlanetId, string> = {
  mercury: "Smallest planet, closest to the Sun",
  venus: "Hottest planet, wrapped in acid cloud",
  earth: "Ocean world, the only known home of life",
  mars: "Cold desert world with a thin atmosphere",
  jupiter: "Largest planet, a gas giant",
  saturn: "Ringed gas giant",
  uranus: "Ice giant tipped on its side",
  neptune: "Outermost planet, an ice giant",
};

const kilometres = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function spin(hours: number) {
  const span = formatDuration(Math.abs(hours) * 3600);
  return hours < 0 ? `${span}, backwards` : span;
}

function year(days: number) {
  return days < 800
    ? `${days.toFixed(days < 100 ? 1 : 0)} days`
    : `${(days / 365.256).toFixed(1)} years`;
}

function planetFacts(id: PlanetId): Facts {
  const orbit = orbital[id];
  return {
    summary: planetSummary[id],
    rows: [
      { label: "From Sun", value: `${orbit.au.toFixed(orbit.au < 10 ? 2 : 1)} AU` },
      { label: "Light time", value: formatDuration(lightTimeSeconds(orbit.au)) },
      { label: "Rotation", value: spin(rotationHours[id]) },
      { label: "Year", value: year(orbit.periodDays) },
      { label: "Gravity", value: `${gravity[id].toFixed(2)} g` },
      { label: "Radius", value: `${kilometres.format(radiusKm[id])} km` },
    ],
  };
}

/**
 * The fixed part of a destination's data card. Values that change as you move
 * (distance to Gargantua, the station's spin) are added by the HUD.
 */
export function facts(destination: Destination): Facts {
  switch (destination) {
    case "system":
      return {
        summary: "Eight planets around one star",
        rows: [
          { label: "Age", value: "4.6 billion years" },
          { label: "Sun to Neptune", value: `${orbital.neptune.au.toFixed(1)} AU` },
          {
            label: "Light to Neptune",
            value: formatDuration(lightTimeSeconds(orbital.neptune.au)),
          },
          { label: "Scale", value: "Distances compressed" },
        ],
      };
    case "sun":
      return {
        summary: "Yellow dwarf star, 99.86% of the system's mass",
        rows: [
          { label: "Radius", value: `${kilometres.format(radiusKm.sun)} km` },
          { label: "Surface", value: "5,500 °C" },
          { label: "Rotation", value: spin(rotationHours.sun) },
          { label: "Gravity", value: "28 g" },
          { label: "Light to Earth", value: formatDuration(lightTimeSeconds(1)) },
        ],
      };
    case "galaxy":
      return {
        summary: "Barred spiral galaxy, our home",
        rows: [
          { label: "Diameter", value: "100,000 light-years" },
          { label: "Stars", value: "100–400 billion" },
          { label: "Sun from centre", value: "26,000 light-years" },
          { label: "Sun's orbit", value: "230 million years" },
        ],
      };
    case "blackhole":
      return {
        summary: "Supermassive black hole from Interstellar",
        rows: [
          { label: "Mass", value: "100 million Suns" },
          { label: "Horizon radius", value: "295 million km" },
          { label: "Model", value: "Non-rotating" },
        ],
      };
    case "station":
      return {
        summary: "Rotating cylinder habitat in Saturn orbit",
        rows: [
          { label: "Radius", value: "3.2 km" },
          { label: "Orbits", value: "Saturn" },
          { label: "From Sun", value: "9.57 AU" },
          { label: "Gravity from", value: "Spin, not mass" },
        ],
      };
    default:
      return planetFacts(destination);
  }
}
