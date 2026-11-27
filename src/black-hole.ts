import * as THREE from "three";

/** World units per Schwarzschild radius (r_s). */
export const HORIZON_RADIUS = 0.84;
/** The disk's inner edge sits at the innermost stable orbit, 3 r_s. */
const DISK_INNER = 3;
const DISK_OUTER = 12.5;

/**
 * Gargantua as a gravitational lens.
 *
 * Nothing here is a picture of a black hole. For every pixel the shader walks
 * that pixel's light path backwards from the camera, bending it at each step
 * the way a non-rotating (Schwarzschild) black hole bends light, and reports
 * what the path ends on:
 *
 *  - the horizon: black;
 *  - the accretion disk, each time the path crosses the disk's plane. A path
 *    that passes over the hole is bent down onto the far side of the disk,
 *    which is why the disk appears to arch over and under the shadow;
 *  - the sky, looked up in the direction the path finally leaves in, so the
 *    stars behind the hole are displaced and smeared into an Einstein ring.
 *
 * Distances are in units of r_s, where the bending of a light path reduces to
 * one line: acceleration = -1.5 * h^2 * position / r^5, with h the path's
 * (conserved) angular momentum.
 */
export function makeBlackHole(sky: {
  panorama: THREE.IUniform;
  orientation: THREE.IUniform;
}) {
  // A slight roll, so the disk is not dead level on screen.
  const frame = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationZ(0.12),
  );
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      eye: { value: new THREE.Vector3() },
      frame: { value: frame },
      panorama: sky.panorama,
      orientation: sky.orientation,
      exposure: { value: 0.2 },
      time: { value: 0 },
      steps: { value: 160 },
    },
    vertexShader: /* glsl */ `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 eye;
      uniform mat3 frame;
      uniform sampler2D panorama;
      uniform mat3 orientation;
      uniform float exposure;
      uniform float time;
      uniform int steps;
      varying vec3 direction;

      const float DISK_INNER = ${DISK_INNER.toFixed(1)};
      const float DISK_OUTER = ${DISK_OUTER.toFixed(1)};
      const float FLOW_PERIOD = 48.0;

      float hash(vec2 p) {
        vec3 v = fract(vec3(p.xyx) * 0.1031);
        v += dot(v, v.yzx + 33.33);
        return fract((v.x + v.y) * v.z);
      }

      float hash3(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }

      float noise(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
          mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      // Point stars are drawn by this shader rather than as geometry, because
      // only something evaluated per bent ray can be lensed.
      vec3 stars(vec3 ray) {
        vec3 p = ray * 150.0;
        vec3 cell = floor(p);
        float chance = hash3(cell);
        if (chance < 0.9) return vec3(0.0);
        vec3 centre = cell + 0.25 + 0.5 * vec3(
          hash3(cell + 7.1), hash3(cell + 13.7), hash3(cell + 23.3));
        float distance = length(p - centre);
        float energy = pow((chance - 0.9) * 10.0, 4.0);
        float core = exp(-distance * distance * 60.0);
        vec3 tint = mix(vec3(1.0, 0.82, 0.62), vec3(0.66, 0.78, 1.0), hash3(cell + 3.3));
        return tint * core * (0.25 + energy * 3.2);
      }

      vec3 skyLight(vec3 ray) {
        vec3 r = normalize(orientation * ray);
        vec2 uv = vec2(
          atan(r.z, r.x) * 0.15915494 + 0.5,
          asin(clamp(r.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        // The bent direction jumps at the shadow's edge, so automatic mip
        // selection would smear there; read the full-resolution map.
        vec3 milkyWay = pow(max(textureLod(panorama, uv, 0.0).rgb, vec3(0.0)), vec3(1.52));
        return milkyWay * exposure + stars(ray) * exposure * 4.0;
      }

      // Gas pattern in the disk plane. Inner orbits are faster, so the pattern
      // shears; "phase" restarts it before it winds up into noise.
      float gas(vec2 p, float r, float phase) {
        float angle = (phase - 0.5) * FLOW_PERIOD * 0.62 * pow(r, -1.5);
        float c = cos(angle);
        float s = sin(angle);
        vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
        float clumps = noise(q * 0.9) * 0.6 + noise(q * 2.7 + 19.0) * 0.4;
        float lanes = noise(vec2(r * 7.0, 3.0)) * 0.55 + noise(vec2(r * 23.0, 9.0)) * 0.45;
        return clumps * 0.55 + lanes * 0.6;
      }

      vec4 disk(vec3 hit, vec3 travel, float r) {
        float inner = smoothstep(DISK_INNER, DISK_INNER + 0.55, r);
        float outer = 1.0 - smoothstep(DISK_OUTER * 0.62, DISK_OUTER, r);
        float phase = fract(time / FLOW_PERIOD);
        float blend = abs(phase * 2.0 - 1.0);
        float structure = mix(
          gas(hit.xz, r, phase),
          gas(hit.xz + 41.0, r, fract(phase + 0.5)),
          blend);

        // Gas orbits at a large fraction of light speed: the side moving
        // toward the camera is brighter and whiter. Softened, as the far side
        // would otherwise all but vanish.
        float beta = min(sqrt(0.5 / r), 0.62);
        vec3 orbit = normalize(vec3(-hit.z, 0.0, hit.x));
        float toward = dot(orbit, -normalize(travel));
        float doppler = sqrt(1.0 - beta * beta) / (1.0 - beta * toward);
        float boost = mix(1.0, doppler * doppler * doppler, 0.6);
        // Light climbing out of the well loses energy.
        float climb = sqrt(1.0 - 1.0 / r);

        float glow = pow(DISK_INNER / r, 2.2) * inner * outer;
        float density = glow * (0.22 + structure * structure * 1.5);
        float heat = clamp(density * doppler * 1.15, 0.0, 1.0);
        vec3 tint = mix(vec3(1.0, 0.34, 0.07), vec3(1.0, 0.88, 0.70), heat * heat);
        vec3 light = tint * density * boost * climb * 2.9;
        float opacity = clamp(inner * outer * (0.35 + structure * 0.75), 0.0, 0.94);
        return vec4(light, opacity);
      }

      void main() {
        vec3 position = frame * eye;
        vec3 velocity = normalize(frame * direction);
        vec3 momentum = cross(position, velocity);
        float h2 = dot(momentum, momentum);
        // Lower tiers take fewer, longer steps.
        float coarse = 160.0 / float(steps);

        vec3 light = vec3(0.0);
        float clear = 1.0;
        bool swallowed = false;

        for (int i = 0; i < 160; i++) {
          if (i >= steps) break;
          float r2 = dot(position, position);
          if (r2 < 1.0) {
            swallowed = true;
            break;
          }
          float r = sqrt(r2);
          // Short steps where the path bends hardest, long ones far out.
          float dt = coarse * min(0.035 * r2, 0.3 * (r - 0.9));
          velocity += -1.5 * h2 * position / (r2 * r2 * r) * dt;
          vec3 next = position + velocity * dt;

          if (position.y * next.y < 0.0) {
            vec3 hit = mix(position, next, position.y / (position.y - next.y));
            float hitRadius = length(hit.xz);
            if (hitRadius > DISK_INNER && hitRadius < DISK_OUTER) {
              vec4 gasLight = disk(hit, velocity, hitRadius);
              light += clear * gasLight.rgb;
              clear *= 1.0 - gasLight.a;
            }
          }
          position = next;
          if (clear < 0.02) break;
          // Leaving, and past 18 r_s: the bend still to come is under half a degree.
          if (r2 > 324.0 && dot(position, velocity) > 0.0) break;
        }

        if (!swallowed) {
          // transpose(frame) rotates the escaping direction back to the world.
          light += clear * skyLight(normalize(velocity) * frame);
        }
        gl_FragColor = vec4(light, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    update(camera: THREE.Camera, seconds: number) {
      mesh.position.copy(camera.position);
      material.uniforms.eye.value.copy(camera.position).divideScalar(HORIZON_RADIUS);
      material.uniforms.time.value = seconds;
    },
    /** Fewer steps on lower tiers; a uniform, so changing it never recompiles. */
    setQuality(steps: number) {
      material.uniforms.steps.value = steps;
    },
  };
}
