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

export function makeBlackHole() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { time: { value: 0 }, inclination: { value: 0.13 } },
    vertexShader: `
      varying vec2 field;
      void main() {
        field = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 field;
      uniform float time;
      uniform float inclination;
      float diskBands(float radius, float angle) {
        float shear = time * 0.38 / (0.4 + radius);
        float ripple = sin(radius * 28.0 + sin(angle * 4.0 + shear) * 1.8);
        float thread = sin(radius * 91.0 + angle * 5.0 + shear * 3.0);
        float knots = sin(angle * 12.0 + radius * 7.0 - shear * 2.0);
        return 0.53 + ripple * 0.19 + thread * 0.12 + knots * 0.12;
      }
      void main() {
        vec2 q = field * 4.15;
        float r = length(q);
        float angle = atan(q.y, q.x);
        float horizon = 1.0 - smoothstep(1.015, 1.04, r);
        float tilt = clamp(abs(inclination), 0.095, 0.78);
        float nearSide = step(0.0, q.y * -sign(inclination));
        vec2 disk = vec2(q.x, q.y / tilt);
        float d = length(disk);
        float envelope = smoothstep(1.03, 1.19, d) * (1.0 - smoothstep(1.35, 3.65, d));
        float direct = envelope * diskBands(d, atan(disk.y, disk.x)) * (1.0 - horizon * (1.0 - nearSide));
        float vertical = q.y * (q.y > 0.0 ? 1.10 : 1.45);
        float lensedRadius = length(vec2(q.x * 0.95, vertical));
        float arcMask = smoothstep(0.17, 0.69, abs(q.y));
        float arch = smoothstep(1.0, 1.065, lensedRadius) * (1.0 - smoothstep(1.08, 1.57, lensedRadius));
        float lensed = arch * arcMask * diskBands(lensedRadius * 2.7, angle) * (1.0 - horizon);
        lensed *= q.y > 0.0 ? 0.98 : 0.48;
        float ring = exp(-abs(r - 1.044) * 100.0) * 0.55;
        float boost = 0.72 + 0.30 * clamp(-q.x, -1.0, 1.0);
        float light = (direct * 1.55 + lensed * 1.62 + ring) * boost;
        float glow = exp(-abs(r - 1.12) * 3.7) * (1.0 - horizon) * 0.18;
        glow += exp(-abs(q.y) * 7.5) * exp(-abs(q.x) * 0.45) * (1.0 - smoothstep(2.0, 4.0, abs(q.x))) * (1.0 - horizon) * 0.16;
        float alpha = clamp(horizon + light * 1.22 + glow, 0.0, 1.0);
        vec3 hot = mix(vec3(0.95, 0.26, 0.045), vec3(1.0, 0.90, 0.72), smoothstep(0.07, 0.67, light));
        vec3 radiance = hot * (light * 2.4 + glow * 0.75);
        gl_FragColor = vec4(radiance / max(alpha, 0.001), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(billboards, material);
  mesh.scale.setScalar(9.1);
  mesh.renderOrder = 2;
  const cameraRotation = new THREE.Euler(0, 0, -0.12);
  const roll = new THREE.Quaternion().setFromEuler(cameraRotation);
  return {
    mesh,
    update(camera: THREE.Camera, time: number) {
      material.uniforms.time.value = time;
      material.uniforms.inclination.value =
        camera.position.y / camera.position.length();
      mesh.quaternion.copy(camera.quaternion).multiply(roll);
    },
  };
}
