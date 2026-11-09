import * as THREE from "three";
import { RIM_RADIUS_METERS } from "./physics";

export const RADIUS = RIM_RADIUS_METERS / 1000;
export const HALF_LENGTH = 6.1;
export const TAU = Math.PI * 2;
const ANGLE_OFFSET = -Math.PI * 1.5;

const CITY_CENTER_U = 0.455;
const CITY_CENTER_V = 0.73;
const CITY_GRADE = 0.103;
export const CITY_HALF_WIDTH = 0.71;
export const CITY_HALF_LENGTH = 1.02;
export const CITY_LANDING = { x: 0, z: 0.78 };
export const CITY_DECK = 0.0012;

export function citySurface(x: number, z: number) {
  return {
    u: CITY_CENTER_U + x / (RADIUS * TAU),
    v: CITY_CENTER_V + z / (HALF_LENGTH * 2),
  };
}

export function cityCoordinates(u: number, v: number) {
  return {
    x: (u - CITY_CENTER_U) * RADIUS * TAU,
    z: (v - CITY_CENTER_V) * HALF_LENGTH * 2,
  };
}

export function cityPoint(x: number, z: number, height = CITY_DECK) {
  const { u, v } = citySurface(x, z);
  return terrainPoint(u, v, height);
}

export function surfaceAngle(u: number) {
  return u * TAU + ANGLE_OFFSET;
}

export function riverCenter(v: number) {
  return 0.53 + Math.sin(v * 10 + 0.3) * 0.029 + Math.sin(v * 20 - 1.9) * 0.014;
}

export function terrainHeight(u: number, v: number) {
  const hills = (Math.sin(u * TAU * 3 + 1.2) * 0.5 + 0.5) ** 3;
  const rolling =
    Math.sin(v * 19 - u * TAU * 4) * Math.sin(v * 13 + u * TAU * 5);
  const bank = Math.min(Math.abs(u - riverCenter(v)) * 30, 1);
  const naturalHeight =
    (0.03 + hills * (0.29 + rolling * 0.17)) * bank +
    0.022 * Math.sin(u * TAU * 14 + v * 29) * bank;
  const x = Math.abs((u - CITY_CENTER_U) * RADIUS * TAU);
  const z = Math.abs((v - CITY_CENTER_V) * HALF_LENGTH * 2);
  const urban =
    (1 -
      THREE.MathUtils.smoothstep(x, CITY_HALF_WIDTH, CITY_HALF_WIDTH + 0.18)) *
    (1 -
      THREE.MathUtils.smoothstep(z, CITY_HALF_LENGTH, CITY_HALF_LENGTH + 0.2));
  return THREE.MathUtils.lerp(naturalHeight, CITY_GRADE, urban);
}

export function terrainPoint(u: number, v: number, height = 0) {
  const angle = surfaceAngle(u);
  const r = RADIUS - terrainHeight(u, v) - height;
  return new THREE.Vector3(
    Math.cos(angle) * r,
    Math.sin(angle) * r,
    (v * 2 - 1) * HALF_LENGTH,
  );
}
