import * as THREE from "three";
import { seededRandom } from "./environment";

const billboards = new THREE.PlaneGeometry(2, 2);

export function makeGalaxy() {
  const galaxy = new THREE.Group();
  const random = seededRandom(91204);
  const positions = [];
  const shades = [];
  const sizes = [];
  const color = new THREE.Color();
  for (let i = 0; i < 22500; i++) {
    const central = i < 4200;
    const radius = central ? random() ** 2 * 3.6 : 1.4 + random() ** 0.84 * 9.3;
    const scatter =
      (random() + random() + random() - 1.5) * (0.29 + radius * 0.047);
    const arm =
      i % 13 === 0
        ? random() * Math.PI * 2
        : (Math.floor(random() * 4) * Math.PI) / 2;
    const angle = central
      ? random() * 2 * Math.PI
      : arm + Math.log(radius / 1.4) * 2.24 + scatter;
    positions.push(
      Math.cos(angle) * radius * (central ? 1.33 : 1),
      (random() + random() - 1) * (central ? 0.95 : 0.34) * (1 - radius / 13),
      Math.sin(angle) * radius * (central ? 0.49 : 1),
    );
    color.setHex(central ? 0xffd8aa : random() > 0.76 ? 0xe1a0bb : 0xa6c9ff);
    color.multiplyScalar(0.13 + random() ** 2 * 0.82);
    shades.push(color.r, color.g, color.b);
    sizes.push(0.6 + random() ** 3 * 3.3);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  stars.setAttribute("shade", new THREE.Float32BufferAttribute(shades, 3));
  stars.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  galaxy.add(
    new THREE.Points(
      stars,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
      attribute float size;
      attribute vec3 shade;
      varying vec3 tint;
      void main() {
        tint = shade;
        vec4 eye = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * 20.0 / max(-eye.z, 1.0), 1.0, 5.0);
        gl_Position = projectionMatrix * eye;
      }
    `,
        fragmentShader: `
      varying vec3 tint;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(tint, 0.72 * exp(-radius * radius * 5.5) * (1.0 - smoothstep(0.7, 1.0, radius)));
        #include <colorspace_fragment>
      }
    `,
      }),
    ),
  );
  const dust = new THREE.Mesh(
    billboards,
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
      varying vec2 field;
      void main() {
        field = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      fragmentShader: `
      varying vec2 field;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(123.1, 79.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
          mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
      }
      void main() {
        float r = length(field);
        float t = atan(field.y, field.x);
        float grain = noise(field * 29.0) * 0.55 + noise(field * 76.0) * 0.30 + noise(field * 176.0) * 0.15;
        float phase = t + log(max(r, 0.07) / 0.12) * 2.24 + grain * 0.37;
        float arms = pow(max(cos(phase * 4.0), 0.0), 3.3);
        float bar = exp(-length(field * vec2(1.0, 3.3)) * 14.0);
        float haze = (0.18 + arms * grain * (1.4 + cos(t * 3.0 + r * 6.0) * 0.32)) * exp(-r * 2.0) * (1.0 - smoothstep(0.73, 1.0, r));
        vec3 tint = mix(vec3(0.19, 0.30, 0.61), vec3(0.91, 0.56, 0.33), exp(-r * 7.0));
        gl_FragColor = vec4(tint, haze * 0.8 + bar * 0.8);
        #include <colorspace_fragment>
      }
    `,
    }),
  );
  dust.scale.setScalar(12);
  dust.rotation.x = -Math.PI / 2;
  galaxy.add(dust);
  return galaxy;
}
