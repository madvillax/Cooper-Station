import * as THREE from "three";
import { seededRandom } from "./environment";

const billboards = new THREE.PlaneGeometry(2, 2);

/** How tightly the arms wind: angle gained per e-fold of radius. */
const ARM_PITCH = 2.24;
const ARM_START = 1.4;
const DISK_RADIUS = 10.7;
/** The Sun sits about 26,000 light-years out in a disk 50,000 across. */
export const SOL_RADIUS = DISK_RADIUS * 0.52;

const spiral = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(123.1, 79.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
  }
  // Angle of a point relative to the nearest of the four arms.
  float armPhase(vec2 field, float r, float wobble) {
    return atan(field.y, field.x) + log(max(r, 0.07) / 0.12) * ${ARM_PITCH.toFixed(2)} + wobble;
  }
`;

const planeVertex = /* glsl */ `
  varying vec2 field;
  void main() {
    field = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The Milky Way seen from outside: a barred spiral. Stars follow four
 * logarithmic arms; the old, yellow population fills the central bar; dark
 * dust runs along the inner edge of each arm and hides what lies under it;
 * pink knots mark gas clouds where stars are forming. A ring marks the Sun.
 */
export function makeGalaxy() {
  const galaxy = new THREE.Group();
  const random = seededRandom(91204);
  const positions = [];
  const shades = [];
  const sizes = [];
  const color = new THREE.Color();
  const STARS = 40000;
  const BULGE = 8000;
  for (let i = 0; i < STARS; i++) {
    const central = i < BULGE;
    const radius = central
      ? random() ** 2 * 3.6
      : ARM_START + random() ** 0.84 * (DISK_RADIUS - ARM_START);
    const scatter =
      (random() + random() + random() - 1.5) * (0.26 + radius * 0.045);
    const arm =
      i % 11 === 0
        ? random() * Math.PI * 2
        : (Math.floor(random() * 4) * Math.PI) / 2;
    const angle = central
      ? random() * 2 * Math.PI
      : arm + Math.log(radius / ARM_START) * ARM_PITCH + scatter;
    positions.push(
      Math.cos(angle) * radius * (central ? 1.33 : 1),
      (random() + random() - 1) * (central ? 0.9 : 0.3) * (1 - radius / 13),
      Math.sin(angle) * radius * (central ? 0.49 : 1),
    );
    // A few stars are far brighter than the rest; they catch the bloom.
    const rank = random();
    const energy = rank > 0.992 ? 1.6 + random() * 2.4 : 0.1 + rank ** 3 * 0.75;
    color.setHex(central ? 0xffd2a0 : random() > 0.8 ? 0xffe2c4 : 0xa9c8ff);
    color.multiplyScalar(energy);
    shades.push(color.r, color.g, color.b);
    sizes.push(0.6 + random() ** 3 * 3.3);
  }
  // Star-forming regions: glowing hydrogen, strung along the arms.
  for (let i = 0; i < 130; i++) {
    const radius = 2.2 + random() ** 0.9 * 7.6;
    const arm = (Math.floor(random() * 4) * Math.PI) / 2;
    const angle =
      arm + Math.log(radius / ARM_START) * ARM_PITCH + (random() - 0.5) * 0.16;
    positions.push(
      Math.cos(angle) * radius,
      (random() - 0.5) * 0.08,
      Math.sin(angle) * radius,
    );
    color.setHex(0xff6f9a).multiplyScalar(0.9 + random() * 1.3);
    shades.push(color.r, color.g, color.b);
    sizes.push(4 + random() * 4);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  stars.setAttribute("shade", new THREE.Float32BufferAttribute(shades, 3));
  stars.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  const points = new THREE.Points(
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
        gl_PointSize = clamp(size * 20.0 / max(-eye.z, 1.0), 1.0, 6.0);
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
  );
  points.renderOrder = 1;

  // Unresolved starlight: the soft glow of the arms and the bright bar.
  const glow = new THREE.Mesh(
    billboards,
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: planeVertex,
      fragmentShader: `
      varying vec2 field;
      ${spiral}
      void main() {
        float r = length(field);
        if (r > 1.0) discard;
        float t = atan(field.y, field.x);
        float grain = noise(field * 29.0) * 0.62 + noise(field * 96.0) * 0.38;
        float arms = pow(max(cos(armPhase(field, r, grain * 0.37) * 4.0), 0.0), 3.3);
        float bar = exp(-length(field * vec2(1.0, 3.3)) * 13.0);
        float core = exp(-r * 34.0);
        float haze = (0.16 + arms * grain * (1.4 + cos(t * 3.0 + r * 6.0) * 0.32)) * exp(-r * 2.0) * (1.0 - smoothstep(0.73, 1.0, r));
        vec3 tint = mix(vec3(0.19, 0.30, 0.61), vec3(0.95, 0.60, 0.34), exp(-r * 7.0));
        vec3 light = tint * (haze * 0.8 + bar * 0.95) + vec3(1.0, 0.78, 0.5) * core * 2.6;
        gl_FragColor = vec4(light, 1.0);
        #include <colorspace_fragment>
      }
    `,
    }),
  );
  glow.scale.setScalar(12);
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 0;

  // Dust lanes. Drawn after the stars with ordinary blending, so they darken
  // whatever is already there instead of adding light.
  const dust = new THREE.Mesh(
    billboards,
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: planeVertex,
      fragmentShader: `
      varying vec2 field;
      ${spiral}
      void main() {
        float r = length(field);
        if (r < 0.1 || r > 0.9) discard;
        float grain = noise(field * 21.0) * 0.58 + noise(field * 80.0) * 0.42;
        // Shifted a little ahead of the arms: dust piles up on their inner edge.
        float lanes = pow(max(cos(armPhase(field, r, grain * 0.5) * 4.0 + 1.05), 0.0), 5.0);
        float reach = smoothstep(0.1, 0.22, r) * (1.0 - smoothstep(0.62, 0.9, r));
        float cover = lanes * (0.35 + grain * 0.9) * reach * 0.82;
        gl_FragColor = vec4(vec3(0.012, 0.008, 0.007), clamp(cover, 0.0, 0.9));
        #include <colorspace_fragment>
      }
    `,
    }),
  );
  dust.scale.setScalar(12);
  dust.rotation.x = -Math.PI / 2;
  dust.position.y = 0.02;
  dust.renderOrder = 2;

  // "You are here": on a spur between two arms, 26,000 light-years out.
  const solAngle = Math.log(SOL_RADIUS / ARM_START) * ARM_PITCH + Math.PI / 4;
  const sol = new THREE.Vector3(
    Math.cos(solAngle) * SOL_RADIUS,
    0,
    Math.sin(solAngle) * SOL_RADIUS,
  );
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.235, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffb86b,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.copy(sol).setY(0.05);
  marker.renderOrder = 4;
  galaxy.userData.sol = sol;

  galaxy.add(glow, points, dust, marker);
  return galaxy;
}
