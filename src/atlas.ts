import * as THREE from "three";
import { makeBlackHole } from "./black-hole";
import { makeGalaxy } from "./deep-space";
import {
  planets,
  type Destination,
  type SolarDestination,
} from "./destinations";
import {
  MOON_PERIOD_DAYS,
  orbital,
  overviewSize,
  radiusKm,
  rotationHours,
  type BodyId,
} from "./bodies-data";
import { loadTexture, makeSolarCorona, seededRandom } from "./environment";
import { orbitAngle } from "./physics";
import type { Stage } from "./warmup";

const TAU = Math.PI * 2;
const sunDirection = new THREE.Vector3(-0.9, 0.38, 0.62).normalize();
const sphere = new THREE.SphereGeometry(1, 96, 64);
/** Radius of the atmosphere shell, in planet radii. */
const AIR_SHELL = 1.07;

/**
 * A point on a planet's orbit, in scene units. Orbits lie in the horizontal
 * plane and run counter-clockwise seen from the north, like the real ones.
 */
function onOrbit(angle: number, radius: number, target: THREE.Vector3) {
  return target.set(Math.cos(angle) * radius, 0, -Math.sin(angle) * radius);
}

export function createAtlas(
  invalidate: () => void,
  upload: (texture: THREE.Texture) => void,
  sky: { panorama: THREE.IUniform; orientation: THREE.IUniform },
) {
  const root = new THREE.Group();
  const system = new THREE.Group();
  const close = new THREE.Group();
  const bodies = new Map<BodyId, ReturnType<typeof body>>();
  const textureJobs = new Map<string, () => Promise<void>>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const sunlight = new THREE.Vector3();
  const blackHole = makeBlackHole(sky);
  const galaxy = makeGalaxy();
  let uranusRing: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial> | undefined;
  root.add(system, close, galaxy, blackHole.mesh);
  const corona = makeSolarCorona();

  const emptyTexture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
  );
  emptyTexture.needsUpdate = true;

  // Maps load on request, not at creation, so entry decides what it waits for.
  function texture(name: string, onLoad: (image: THREE.Texture) => void) {
    let loading: Promise<void> | undefined;
    textureJobs.set(name, () => {
      loading ??= loadTexture(
        `${import.meta.env.BASE_URL}space/${name}.webp`,
      ).then((image) => {
        image.anisotropy = 4;
        upload(image);
        onLoad(image);
        invalidate();
      });
      return loading;
    });
  }

  /** Saturn hangs behind the station, so the station view needs only its maps. */
  function textureStages(group: "station" | "system"): Stage[] {
    return [...textureJobs]
      .filter(([name]) => group === "system" || name.startsWith("saturn"))
      .map(([name, run]) => ({
        label: "Loading star catalogue",
        weight: name === "jupiter" || name === "saturn" ? 2 : 1,
        optional: true,
        run,
      }));
  }

  /** Begins downloads and decodes without waiting, so they overlap other work. */
  function preload(group: "station" | "system") {
    for (const stage of textureStages(group)) void Promise.resolve(stage.run()).catch(() => {});
  }

  function body(id: BodyId, color: number, tilt = 0) {
    const frame = new THREE.Group();
    const axis = new THREE.Group();
    axis.rotation.z = tilt;
    frame.add(axis);
    const atmosphere =
      id === "earth"
        ? 0.78
        : id === "venus" || id === "neptune" || id === "uranus"
          ? 0.36
          : 0.12;
    const light = sunDirection.clone();
    const pole = new THREE.Vector3(0, 1, 0);
    const giant =
      id === "jupiter" || id === "saturn" || id === "uranus" || id === "neptune";
    const airColor = new THREE.Color(
      id === "earth" ? 0x538bff : id === "neptune" ? 0x89b7d0 : color,
    );
    const material = new THREE.ShaderMaterial({
      defines: id === "sun" ? { SOLAR_SURFACE: 1 } : {},
      toneMapped: id !== "sun",
      uniforms: {
        surface: { value: emptyTexture },
        clouds: { value: emptyTexture },
        nightMap: { value: emptyTexture },
        ringMap: { value: emptyTexture },
        mapped: { value: 0 },
        clouded: { value: 0 },
        hasNight: { value: 0 },
        ringShadow: { value: 0 },
        ocean: { value: id === "earth" ? 1 : 0 },
        limbDarkening: { value: giant ? 1 : 0 },
        cloudDrift: { value: 0 },
        time: { value: 0 },
        sunlight: { value: light },
        pole: { value: pole },
        tint: { value: new THREE.Color(color) },
        brightness: { value: 1 },
        atmosphere: { value: atmosphere },
        reflectance: {
          value: new THREE.Color(id === "neptune" ? 0xcee8f0 : 0xf0f5f6),
        },
        colorCorrection: {
          value: id === "neptune" ? 0.66 : id === "uranus" ? 0.29 : 0.0,
        },
        airColor: { value: airColor },
      },
      vertexShader: `
        varying vec2 coordinates;
        varying vec3 normalWorld;
        varying vec3 positionWorld;
        void main() {
          coordinates = uv;
          normalWorld = normalize(mat3(modelMatrix) * normal);
          vec4 position = modelMatrix * vec4(position, 1.0);
          positionWorld = position.xyz;
          gl_Position = projectionMatrix * viewMatrix * position;
        }
      `,
      fragmentShader: `
        uniform sampler2D surface;
        uniform sampler2D clouds;
        uniform sampler2D nightMap;
        uniform sampler2D ringMap;
        uniform vec3 sunlight;
        uniform vec3 pole;
        uniform vec3 tint;
        uniform vec3 airColor;
        uniform vec3 reflectance;
        uniform float colorCorrection;
        uniform float atmosphere;
        uniform float mapped;
        uniform float clouded;
        uniform float hasNight;
        uniform float ringShadow;
        uniform float ocean;
        uniform float limbDarkening;
        uniform float cloudDrift;
        uniform float brightness;
        uniform float time;
        varying vec2 coordinates;
        varying vec3 normalWorld;
        varying vec3 positionWorld;

        float hash(vec2 p) {
          vec3 v = fract(vec3(p.xyx) * 0.1031);
          v += dot(v, v.yzx + 33.33);
          return fract((v.x + v.y) * v.z);
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

        void main() {
          vec3 n = normalize(normalWorld);
          vec3 viewDir = normalize(cameraPosition - positionWorld);
          float facing = max(dot(n, viewDir), 0.0);
          #ifdef SOLAR_SURFACE
            // The photosphere boils: push the map around with slow flow noise.
            vec2 cells = coordinates * vec2(46.0, 23.0);
            vec2 flow = vec2(
              noise(cells + vec2(time * 0.05, 3.1)),
              noise(cells + vec2(8.4, -time * 0.04))) - 0.5;
            vec3 ground = mix(tint, texture2D(surface, coordinates + flow * 0.008).rgb, mapped);
            float granules = noise(cells * 4.0 + flow * 6.0 + time * 0.02);
            vec3 plasma = vec3(pow(ground.r, 0.86), ground.g * 0.77, ground.b * 0.55);
            plasma *= 0.86 + granules * 0.22;
            plasma *= 0.90 + facing * 0.10;
            float rim = exp(-facing * facing * 78.0);
            plasma = mix(plasma, vec3(1.0, 0.60, 0.065), rim * 0.90);
            gl_FragColor = vec4(plasma * brightness, 1.0);
          #else
            vec3 ground = mix(tint, texture2D(surface, coordinates).rgb, mapped);
            float edge = pow(1.0 - facing, 3.5);
            float incoming = dot(n, sunlight);
            float day = pow(max(incoming, 0.0), 0.81);
            float twilight = smoothstep(-0.13, 0.32, incoming);
            float luminance = dot(ground, vec3(0.2126, 0.7152, 0.0722));
            // Open water is the only strongly blue-dominant thing on the map.
            float water = ocean * mapped * smoothstep(0.03, 0.14, ground.b - max(ground.r, ground.g) * 0.9);
            ground = mix(ground, luminance * reflectance * 1.25, colorCorrection);

            // East and north on the surface, to offset lookups toward the Sun.
            vec3 east = normalize(cross(pole, n) + vec3(1e-5));
            vec3 north = cross(n, east);
            vec2 sunward = vec2(dot(sunlight, east), dot(sunlight, north));
            float cloud = texture2D(clouds, vec2(fract(coordinates.x + cloudDrift), coordinates.y)).r * clouded;
            // Clouds float above the ground, so their shadow falls down-Sun.
            vec2 shadowAt = coordinates + sunward * 0.0045;
            float cloudShade = texture2D(clouds, vec2(fract(shadowAt.x + cloudDrift), shadowAt.y)).r * clouded;
            ground *= 1.0 - 0.35 * smoothstep(0.12, 0.8, cloudShade) * (1.0 - smoothstep(0.04, 0.5, cloud));
            ground = mix(ground, vec3(0.87, 0.93, 1.0), smoothstep(0.04, 0.86, cloud) * 0.84);

            // Saturn's rings throw a banded shadow across the globe.
            float towardRings = dot(sunlight, pole);
            float reach = -dot(n, pole) / (abs(towardRings) < 1e-4 ? 1e-4 : towardRings);
            vec3 crossing = n + sunlight * reach;
            float ringRadius = length(crossing);
            float ringShade = ringShadow * step(0.0, reach)
              * step(1.19, ringRadius) * step(ringRadius, 2.32)
              * texture2D(ringMap, vec2((ringRadius - 1.19) / 1.13, 0.5)).a;
            day *= 1.0 - 0.82 * ringShade;

            vec3 halfway = normalize(sunlight + viewDir);
            float glint = pow(max(dot(n, halfway), 0.0), 170.0)
              * water * (1.0 - smoothstep(0.04, 0.5, cloud)) * step(0.0, incoming);
            vec3 lights = texture2D(nightMap, coordinates).rgb * hasNight * (1.0 - smoothstep(-0.26, 0.08, incoming)) * 0.82;
            vec3 rendered = ground * (0.017 + day * 1.20) + lights
              + vec3(1.0, 0.94, 0.82) * glint * 0.32
              + airColor * edge * atmosphere * (0.045 + twilight * 0.47);
            // Thick atmospheres absorb more along the slanted path at the limb.
            rendered *= mix(1.0, pow(max(facing, 0.02), 0.35), limbDarkening);
            gl_FragColor = vec4(rendered, 1.0);
          #endif
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const airGlow =
      id === "earth"
        ? 1
        : id === "venus"
          ? 0.8
          : id === "neptune" || id === "uranus"
            ? 0.4
            : id === "jupiter" || id === "saturn"
              ? 0.3
              : id === "mars"
                ? 0.25
                : 0;
    if (airGlow) {
      // The air above the limb, seen edge-on against space: a shell of back
      // faces whose brightness depends on how close each sight line passes
      // to the surface, and on whether that point is in daylight.
      const air = new THREE.Mesh(
        sphere,
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            sunlight: material.uniforms.sunlight,
            airColor: material.uniforms.airColor,
            strength: { value: airGlow },
          },
          vertexShader: `
            varying vec3 normalWorld;
            varying vec3 positionWorld;
            void main() {
              normalWorld = normalize(mat3(modelMatrix) * normal);
              vec4 position = modelMatrix * vec4(position, 1.0);
              positionWorld = position.xyz;
              gl_Position = projectionMatrix * viewMatrix * position;
            }
          `,
          fragmentShader: `
            uniform vec3 sunlight;
            uniform vec3 airColor;
            uniform float strength;
            varying vec3 normalWorld;
            varying vec3 positionWorld;
            void main() {
              vec3 n = normalize(normalWorld);
              vec3 viewDir = normalize(cameraPosition - positionWorld);
              float along = dot(n, viewDir);
              // Closest the sight line comes to the planet's centre, in radii.
              float nearest = ${AIR_SHELL.toFixed(2)} * sqrt(max(1.0 - along * along, 0.0));
              float height = clamp((nearest - 1.0) / ${(AIR_SHELL - 1).toFixed(2)}, 0.0, 1.0);
              float halo = pow(1.0 - height, 3.0);
              vec3 tangentPoint = normalize(n - along * viewDir);
              float lit = smoothstep(-0.04, 0.5, dot(tangentPoint, sunlight));
              gl_FragColor = vec4(airColor * halo * lit * strength * 1.25, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }
          `,
        }),
      );
      air.scale.setScalar(AIR_SHELL);
      frame.add(air);
    }
    const surface = new THREE.Mesh(sphere, material);
    surface.rotation.y = id === "earth" ? 0.96 : id === "jupiter" ? 1.4 : 0;
    axis.add(surface);
    texture(id, (image) => {
      material.uniforms.surface.value = image;
      material.uniforms.mapped.value = 1;
    });
    if (id === "earth") {
      texture("earth-clouds", (image) => {
        material.uniforms.clouds.value = image;
        material.uniforms.clouded.value = 1;
      });
      texture("earth-night", (image) => {
        material.uniforms.nightMap.value = image;
        material.uniforms.hasNight.value = 1;
      });
    }
    if (id === "sun") frame.add(corona.mesh);
    if (id === "saturn" || id === "uranus") {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(
          id === "saturn" ? 1.19 : 1.59,
          id === "saturn" ? 2.32 : 1.91,
          144,
        ),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: {
            sunlight: material.uniforms.sunlight,
            opacity: { value: id === "saturn" ? 0.95 : 0 },
            isUranus: { value: id === "uranus" },
            ringMap: { value: emptyTexture },
            ringMapped: { value: 0 },
          },
          vertexShader: `
            varying vec2 ring;
            varying vec3 offset;
            void main() {
              ring = position.xy;
              offset = normalize(mat3(modelMatrix) * position) * length(position);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            varying vec2 ring;
            varying vec3 offset;
            uniform vec3 sunlight;
            uniform float opacity;
            uniform bool isUranus;
            uniform sampler2D ringMap;
            uniform float ringMapped;
            void main() {
              float r = length(ring);
              float edge = smoothstep(1.19, 1.44, r) * (1.0 - smoothstep(2.22, 2.32, r));
              float bands = 0.56 + sin(r * 82.0) * 0.11 + sin(r * 182.0) * 0.09 + sin(r * 551.0) * 0.10;
              float gap = smoothstep(0.024, 0.043, abs(r - 1.92)) * smoothstep(0.006, 0.014, abs(r - 2.18));
              float shadow = dot(offset, sunlight) > 0.0 ? 1.0 : smoothstep(0.90, 1.08, length(cross(offset, sunlight)));
              vec3 color = mix(vec3(0.68, 0.48, 0.32), vec3(0.64, 0.64, 0.62), smoothstep(1.5, 2.3, r));
              vec4 profile = texture2D(ringMap, vec2(clamp((r - 1.19) / 1.13, 0.0, 1.0), 0.5));
              color = mix(color, profile.rgb * 1.22, ringMapped);
              float coverage = mix(edge * gap * bands, edge * profile.a, ringMapped);
              if (isUranus) {
                color = vec3(0.30, 0.34, 0.37);
                coverage = (1.0 - smoothstep(0.003, 0.014, abs(r - 1.87)))
                  + 0.46 * (1.0 - smoothstep(0.002, 0.008, abs(r - 1.72)))
                  + 0.28 * (1.0 - smoothstep(0.001, 0.006, abs(r - 1.63)));
              }
              gl_FragColor = vec4(color * (0.04 + shadow * 0.93), opacity * coverage);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }
          `,
        }),
      );
      if (id === "saturn") {
        // The globe reads the same ring profile to cast the rings' shadow.
        material.uniforms.ringMap = ring.material.uniforms.ringMap;
        texture("saturn-rings", (image) => {
          ring.material.uniforms.ringMap.value = image;
          ring.material.uniforms.ringMapped.value = 1;
          material.uniforms.ringShadow.value = 1;
        });
      } else {
        ring.visible = false;
        uranusRing = ring;
      }
      ring.rotation.x = -Math.PI / 2;
      axis.add(ring);
    }
    return { frame, axis, surface, material, light, pole };
  }

  for (const planet of planets) {
    const item = body(planet.id, planet.color, planet.tilt);
    bodies.set(planet.id, item);
  }
  bodies.set("sun", body("sun", 0xffa347));
  bodies.set("moon", body("moon", 0xa9a7a1));

  const pickableBodies = [
    "sun",
    ...planets.map((planet) => planet.id),
  ] as const;
  const pickTargets = new Map<
    THREE.Object3D,
    (typeof pickableBodies)[number]
  >();
  for (const id of pickableBodies) {
    const target = bodies.get(id)?.surface;
    if (target) pickTargets.set(target, id);
  }
  const surfaces = [...pickTargets.keys()];
  let current: Destination = "system";
  let simDays = 0;
  let spinHours = 0;

  // Orbit lines and the asteroid belt: aids, not objects, so one switch hides
  // them all.
  const guides = new THREE.Group();
  const point = new THREE.Vector3();
  for (const planet of planets) {
    const path: number[] = [];
    for (let i = 0; i < 160; i++) {
      onOrbit((i / 160) * TAU, planet.orbit, point);
      path.push(point.x, point.y, point.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(path, 3));
    guides.add(
      new THREE.LineLoop(
        geometry,
        new THREE.LineBasicMaterial({
          color: planet.color,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
        }),
      ),
    );
  }
  {
    // The main belt, between Mars and Jupiter.
    const random = seededRandom(4471);
    const rocks: number[] = [];
    for (let i = 0; i < 2200; i++) {
      onOrbit(random() * TAU, 14.3 + (random() + random()) * 1.15, point);
      rocks.push(point.x, point.y + (random() - 0.5) * 0.5, point.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(rocks, 3));
    guides.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: 0x6f695e,
          size: 1.2,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
        }),
      ),
    );
  }
  system.add(guides);

  function setView(
    next: Exclude<Destination, Exclude<SolarDestination, "system">>,
  ) {
    current = next;
    system.visible = next === "system";
    close.visible =
      !system.visible && next !== "galaxy" && next !== "blackhole";
    galaxy.visible = next === "galaxy";
    blackHole.mesh.visible = next === "blackhole";
    for (const [id, item] of bodies) {
      item.frame.visible =
        next === "system" || (next === "station" && id === "saturn");
      if (next === "system") system.add(item.frame);
      else close.add(item.frame);
      item.frame.position.set(0, 0, 0);
      item.frame.scale.setScalar(1);
      item.frame.rotation.set(0, 0, 0);
      item.light.copy(sunDirection);
    }
    if (next === "station") {
      const saturn = bodies.get("saturn")?.frame;
      if (saturn) {
        saturn.position.set(28, 11, -65);
        saturn.scale.setScalar(10.6);
        saturn.rotation.set(0.23, 0.08, -0.28);
      }
    }
    if (next === "system") layOut();
  }

  /** Puts every body where it is on the simulation date. */
  function layOut() {
    const sun = bodies.get("sun");
    if (sun) {
      sun.frame.position.set(0, 0, 0);
      sun.frame.scale.setScalar(overviewSize(radiusKm.sun));
    }
    for (const planet of planets) {
      const item = bodies.get(planet.id);
      if (!item) continue;
      const { meanLongitudeDeg, periodDays } = orbital[planet.id];
      onOrbit(
        orbitAngle(meanLongitudeDeg, periodDays, simDays),
        planet.orbit,
        item.frame.position,
      );
      item.frame.scale.setScalar(overviewSize(radiusKm[planet.id]));
      item.light.copy(sunlight.copy(item.frame.position).negate().normalize());
    }
    const earth = bodies.get("earth");
    const moon = bodies.get("moon");
    if (earth && moon) {
      const radius = earth.frame.scale.x;
      const angle = (simDays / MOON_PERIOD_DAYS) * TAU;
      moon.frame.scale.setScalar(radius * (radiusKm.moon / radiusKm.earth));
      moon.frame.position
        .set(
          Math.cos(angle) * radius * 2.45,
          radius * 0.22,
          -Math.sin(angle) * radius * 2.45,
        )
        .add(earth.frame.position);
      moon.light.copy(earth.light);
    }
  }

  /**
   * Sets the simulation clock. `days` (since J2000) places bodies on their
   * orbits; `hours` turns them on their axes and is advanced separately, so
   * fast-forwarding the orbits does not spin the planets into a blur.
   */
  function setDate(days: number, hours: number) {
    simDays = days;
    spinHours = hours;
  }

  function update(elapsed: number) {
    if (current === "system") layOut();
    if (current === "galaxy") galaxy.rotation.y = elapsed * 0.019;
    const earth = bodies.get("earth");
    if (earth) earth.material.uniforms.cloudDrift.value = (spinHours * 0.0011) % 1;
    for (const [id, item] of bodies) {
      if (item.frame.visible) {
        const offset = id === "earth" ? 0.96 : id === "jupiter" ? 1.4 : 0;
        item.surface.rotation.y = offset + (spinHours / rotationHours[id]) * TAU;
        item.pole
          .set(0, 1, 0)
          .applyQuaternion(item.axis.quaternion)
          .applyQuaternion(item.frame.quaternion);
        item.material.uniforms.time.value = elapsed;
      }
    }
  }

  function faceCamera(camera: THREE.Camera, elapsed: number) {
    if (current === "system") {
      const sun = getBody("sun").frame;
      corona.update(camera, elapsed, sun.position, sun.scale.x);
      if (uranusRing) {
        const uranus = getBody("uranus").frame;
        const distance =
          camera.position.distanceTo(uranus.position) / uranus.scale.x;
        const opacity = 0.36 * (1 - THREE.MathUtils.smoothstep(distance, 6, 13));
        uranusRing.visible = opacity > 0;
        uranusRing.material.uniforms.opacity.value = opacity;
      }
    }
    if (current === "blackhole") blackHole.update(camera, elapsed);
  }

  function getBody(id: Exclude<SolarDestination, "system">) {
    const body = bodies.get(id);
    if (!body) throw new Error(`Missing solar body: ${id}`);
    return body;
  }

  function pickBody(camera: THREE.Camera, x: number, y: number) {
    if (current !== "system") return undefined;
    raycaster.setFromCamera(pointer.set(x, y), camera);
    const hit = raycaster.intersectObjects(surfaces, false)[0];
    return hit && pickTargets.get(hit.object);
  }

  /** In the HDR buffer the Sun is far brighter than white, so it blooms. */
  function setHdr(hdr: boolean) {
    const sun = bodies.get("sun");
    if (sun) sun.material.uniforms.brightness.value = hdr ? 3.5 : 1;
  }

  /** Draws with every group showing, so each one's GPU state exists up front. */
  function warm(draw: () => void) {
    const shown = current;
    system.visible = close.visible = galaxy.visible = blackHole.mesh.visible = true;
    for (const item of bodies.values()) item.frame.visible = true;
    if (uranusRing) uranusRing.visible = true;
    draw();
    setView(
      shown === "galaxy" || shown === "blackhole" || shown === "station"
        ? shown
        : "system",
    );
  }

  setView("system");
  return {
    root,
    setView,
    update,
    faceCamera,
    getBody,
    pickBody,
    textureStages,
    preload,
    warm,
    setHdr,
    setLensQuality: blackHole.setQuality,
    setDate,
    setGuides(visible: boolean) {
      guides.visible = visible;
    },
    /** World position of the Sun's marker in the galaxy view. */
    sol(target: THREE.Vector3) {
      return galaxy.localToWorld(target.copy(galaxy.userData.sol as THREE.Vector3));
    },
  };
}
