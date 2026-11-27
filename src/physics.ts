export const RIM_RADIUS_METERS = 3200;
export const DEFAULT_RPM = 0.53;
export const EARTH_GRAVITY = 9.80665;

export function radiansPerSecond(rpm: number) {
  return (rpm * Math.PI * 2) / 60;
}

export function rimGravity(rpm: number) {
  return (radiansPerSecond(rpm) ** 2 * RIM_RADIUS_METERS) / EARTH_GRAVITY;
}

/** Tangential speed of the habitat floor, in metres per second. */
export function rimSpeed(rpm: number) {
  return radiansPerSecond(rpm) * RIM_RADIUS_METERS;
}

/**
 * How fast a clock held still at `radiusInRs` Schwarzschild radii ticks,
 * compared with one far away. Zero at and inside the horizon.
 */
export function timeDilation(radiusInRs: number) {
  return radiusInRs <= 1 ? 0 : Math.sqrt(1 - 1 / radiusInRs);
}

const LIGHT_SECONDS_PER_AU = 499.004784;

export function lightTimeSeconds(au: number) {
  return au * LIGHT_SECONDS_PER_AU;
}

const J2000_MS = Date.UTC(2000, 0, 1, 12);
const MS_PER_DAY = 86_400_000;

export function daysSinceJ2000(date: Date) {
  return (date.getTime() - J2000_MS) / MS_PER_DAY;
}

export function dateFromJ2000(days: number) {
  return new Date(J2000_MS + days * MS_PER_DAY);
}

/** Position on a circular orbit, in radians within one turn. */
export function orbitAngle(
  meanLongitudeDeg: number,
  periodDays: number,
  days: number,
) {
  const turns = meanLongitudeDeg / 360 + days / periodDays;
  return (turns - Math.floor(turns)) * Math.PI * 2;
}
