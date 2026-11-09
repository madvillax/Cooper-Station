import * as THREE from "three";
import { RIM_RADIUS_METERS } from "./physics";

export const RADIUS = RIM_RADIUS_METERS / 1000;
export const HALF_LENGTH = 6.1;
export const TAU = Math.PI * 2;
export const WATER_LEVEL = 0.034;
const ANGLE_OFFSET = -Math.PI * 1.5;

const CITY_CENTER_U = 0.455;
const CITY_CENTER_V = 0.73;
const CITY_GRADE = 0.103;
export const CITY_HALF_WIDTH = 0.71;
export const CITY_HALF_LENGTH = 1.02;
export const CITY_LANDING = { x: 0, z: 0.78 };
export const CITY_DECK = 0.0012;
export type CityFootprint = {
  x: number;
  z: number;
  width: number;
  depth: number;
};
const cityAxis = new THREE.Vector3(0, 0, 1);

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

export function cityRotation(x: number) {
  return new THREE.Quaternion().setFromAxisAngle(
    cityAxis,
    surfaceAngle(citySurface(x, 0).u) + Math.PI / 2,
  );
}

export function surfaceAngle(u: number) {
  return u * TAU + ANGLE_OFFSET;
}

export function riverCenter(v: number) {
  return 0.53 + Math.sin(v * 10 + 0.3) * 0.029 + Math.sin(v * 20 - 1.9) * 0.014;
}

export function riverWidth(v: number) {
  return 0.0096 + 0.0023 * Math.sin(v * 16 + 0.4) + 0.0014 * Math.sin(v * 31);
}

export function terrainHeight(u: number, v: number) {
  const angle = u * TAU;
  const ridge = 0.5 + 0.5 * Math.sin(angle * 3 + 0.75 * Math.sin(v * 8) + 1.2);
  const rolling = Math.sin(v * 16 - angle * 4) * Math.cos(v * 11 + angle * 5);
  const ridges = Math.sin(angle * 13 + v * 30) * Math.cos(angle * 9 - v * 24);
  const upland =
    0.062 + ridge ** 2.7 * (0.32 + 0.11 * rolling) + 0.028 * ridges;
  const bank = Math.abs(u - riverCenter(v)) / riverWidth(v);
  const riverBed =
    WATER_LEVEL - 0.04 + 0.1 * THREE.MathUtils.smoothstep(bank, 0.68, 1.65);
  const naturalHeight = THREE.MathUtils.lerp(
    riverBed,
    upland,
    THREE.MathUtils.smoothstep(bank, 1.22, 3.4),
  );
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
