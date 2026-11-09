export const RIM_RADIUS_METERS = 3200;
export const DEFAULT_RPM = 0.53;
export const EARTH_GRAVITY = 9.80665;

export function radiansPerSecond(rpm: number) {
  return (rpm * Math.PI * 2) / 60;
}

export function rimGravity(rpm: number) {
  return (radiansPerSecond(rpm) ** 2 * RIM_RADIUS_METERS) / EARTH_GRAVITY;
}
