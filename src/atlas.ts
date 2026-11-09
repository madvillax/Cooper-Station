import * as THREE from "three";
import { makeBlackHole, makeGalaxy } from "./deep-space";
import {
  planets,
  type Destination,
  type SolarDestination,
} from "./destinations";
import { makeSolarCorona } from "./environment";

type BodyId = (typeof planets)[number]["id"] | "sun" | "moon";
const sunDirection = new THREE.Vector3(-0.9, 0.38, 0.62).normalize();
const sphere = new THREE.SphereGeometry(1, 96, 64);
const systemSun = new THREE.Vector3(-8, 1.7, -13);
const systemPlaneTilt = 0.26;

export function createAtlas(invalidate: () => void) {
  const root = new THREE.Group();
  const system = new THREE.Group();
  const close = new THREE.Group();
  const bodies = new Map<BodyId, ReturnType<typeof body>>();
  const loader = new THREE.TextureLoader();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const sunlight = new THREE.Vector3();
  const blackHole = makeBlackHole();
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

  function texture(name: string, onLoad: (image: THREE.Texture) => void) {
    loader.load(`${import.meta.env.BASE_URL}space/${name}.webp`, (image) => {
      image.colorSpace = THREE.SRGBColorSpace;
      image.anisotropy = 4;
      onLoad(image);
      invalidate();
    });
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
    const material = new THREE.ShaderMaterial({
      defines: id === "sun" ? { SOLAR_SURFACE: 1 } : {},
      toneMapped: id !== "sun",
      uniforms: {
        surface: { value: emptyTexture },
        clouds: { value: emptyTexture },
        nightMap: { value: emptyTexture },
        mapped: { value: 0 },
        clouded: { value: 0 },
        hasNight: { value: 0 },
        cloudDrift: { value: 0 },
        sunlight: { value: light },
        tint: { value: new THREE.Color(color) },
        atmosphere: { value: atmosphere },
        reflectance: {
          value: new THREE.Color(id === "neptune" ? 0xcee8f0 : 0xf0f5f6),
        },
        colorCorrection: {
          value: id === "neptune" ? 0.66 : id === "uranus" ? 0.29 : 0.0,
        },
        airColor: {
          value: new THREE.Color(
            id === "earth" ? 0x538bff : id === "neptune" ? 0x89b7d0 : color,
          ),
        },
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
        uniform vec3 sunlight;
        uniform vec3 tint;
        uniform vec3 airColor;
        uniform vec3 reflectance;
        uniform float colorCorrection;
        uniform float atmosphere;
        uniform float mapped;
        uniform float clouded;
        uniform float hasNight;
        uniform float cloudDrift;
        varying vec2 coordinates;
        varying vec3 normalWorld;
        varying vec3 positionWorld;
        void main() {
          vec3 n = normalize(normalWorld);
          vec3 viewDir = normalize(cameraPosition - positionWorld);
          float facing = max(dot(n, viewDir), 0.0);
          vec3 ground = mix(tint, texture2D(surface, coordinates).rgb, mapped);
          #ifdef SOLAR_SURFACE
            vec3 plasma = vec3(pow(ground.r, 0.86), ground.g * 0.77, ground.b * 0.55);
            plasma *= 0.90 + facing * 0.10;
            float rim = exp(-facing * facing * 78.0);
            plasma = mix(plasma, vec3(1.0, 0.60, 0.065), rim * 0.90);
            gl_FragColor = vec4(plasma, 1.0);
          #else
            float edge = pow(1.0 - facing, 3.5);
            float incoming = dot(n, sunlight);
            float day = pow(max(incoming, 0.0), 0.81);
            float twilight = smoothstep(-0.13, 0.32, incoming);
            float luminance = dot(ground, vec3(0.2126, 0.7152, 0.0722));
            ground = mix(ground, luminance * reflectance * 1.25, colorCorrection);
            float cloud = texture2D(clouds, vec2(fract(coordinates.x + cloudDrift), coordinates.y)).r * clouded;
            ground = mix(ground, vec3(0.87, 0.93, 1.0), smoothstep(0.04, 0.86, cloud) * 0.84);
            vec3 lights = texture2D(nightMap, coordinates).rgb * hasNight * (1.0 - smoothstep(-0.26, 0.08, incoming)) * 0.82;
            vec3 rendered = ground * (0.017 + day * 1.20) + lights + airColor * edge * atmosphere * (0.045 + twilight * 0.47);
            gl_FragColor = vec4(rendered, 1.0);
          #endif
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
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
        texture("saturn-rings", (image) => {
          ring.material.uniforms.ringMap.value = image;
          ring.material.uniforms.ringMapped.value = 1;
        });
      } else {
        ring.visible = false;
        uranusRing = ring;
      }
      ring.rotation.x = -Math.PI / 2;
      axis.add(ring);
    }
    return { frame, surface, material, light };
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
  let systemTime = 0;
  let previousTime = 0;

  function setView(
    next: Exclude<Destination, Exclude<SolarDestination, "system">>,
  ) {
    if (next === "system") systemTime = 0;
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
  }

  function update(elapsed: number) {
    if (current === "system") {
      systemTime += elapsed - previousTime;
      const sun = bodies.get("sun");
      if (sun) {
        sun.frame.position.copy(systemSun);
        sun.frame.scale.setScalar(3.5);
      }
      for (const planet of planets) {
        const item = bodies.get(planet.id);
        if (!item) continue;
        const angle =
          planet.phase + systemTime * (0.006 / Math.sqrt(planet.orbit));
        const depth = Math.sin(angle) * planet.orbit;
        item.frame.position.set(
          systemSun.x + Math.cos(angle) * planet.orbit,
          systemSun.y - depth * systemPlaneTilt,
          systemSun.z + depth,
        );
        const foregroundScale =
          planet.id === "saturn" ? 2.85 : planet.id === "jupiter" ? 0.72 : 0.48;
        item.frame.scale.setScalar(planet.size * foregroundScale);
        item.light.copy(
          sunlight.copy(systemSun).sub(item.frame.position).normalize(),
        );
      }
      const earth = bodies.get("earth");
      const moon = bodies.get("moon");
      if (earth && moon) {
        const radius = earth.frame.scale.x;
        const angle = 0.64 + elapsed * 0.039;
        moon.frame.scale.setScalar(radius * 0.273);
        moon.frame.position
          .set(
            Math.cos(angle) * radius * 2.45,
            radius * 0.22,
            -Math.sin(angle) * radius * 2.45,
          )
          .add(earth.frame.position);
        moon.light.copy(earth.light);
        earth.material.uniforms.cloudDrift.value = (elapsed * 0.0018) % 1;
      }
    }
    previousTime = elapsed;
    if (current === "galaxy") galaxy.rotation.y = elapsed * 0.019;
    for (const [id, item] of bodies) {
      if (item.frame.visible) {
        const offset = id === "earth" ? 0.96 : id === "jupiter" ? 1.4 : 0;
        item.surface.rotation.y =
          offset + elapsed * (id === "jupiter" ? 0.086 : 0.042);
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

  setView("system");
  return { root, setView, update, faceCamera, getBody, pickBody };
}
