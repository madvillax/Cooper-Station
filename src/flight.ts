import * as THREE from "three";
import { createAtlas } from "./atlas";
import {
  isSolarDestination,
  solarRoute,
  type Destination,
  type SolarDestination,
  type View,
} from "./destinations";
import { makeSkyDome, makeStarField } from "./environment";
import { DEFAULT_RPM, radiansPerSecond } from "./physics";
import { createPost } from "./post";
import { createGovernor, tierSettings, type Tier } from "./quality";
import { createStation } from "./station";
import {
  macrotask,
  runStages,
  warmGroup,
  warmOrder,
  type Stage,
  type WarmGroup,
} from "./warmup";
import {
  CITY_DECK,
  CITY_LANDING,
  cityCoordinates,
  cityPoint,
  citySurface,
  HALF_LENGTH,
  RADIUS,
  TAU,
  surfaceAngle,
  terrainPoint,
} from "./habitat-surface";

function isHabitatView(view: View): view is "habitat" | "ground" {
  return view === "habitat" || view === "ground";
}

function viewFov(view: View, inside = isHabitatView(view)) {
  return view === "ground" ? 61 : inside ? 51 : 42;
}

type Orbit = { yaw: number; pitch: number; zoom: number };
type Walk = { u: number; v: number; yaw: number; pitch: number };
type Pose = { position: THREE.Vector3; rotation: THREE.Quaternion };
type Transition = {
  from: Pose;
  elapsed: number;
  duration: number;
  route: "inbound" | "outbound" | "orbital" | "landing" | "takeoff";
};

const defaultOrbit: Record<Exclude<View, "habitat" | "ground">, Orbit> = {
  orbital: { yaw: -0.07, pitch: 0.13, zoom: 1 },
  cutaway: { yaw: 0.37, pitch: 0.35, zoom: 1 },
};
const flyoverStart: Walk = { ...citySurface(0, 2.27), yaw: 0.035, pitch: -0.1 };
const groundStart: Walk = {
  ...citySurface(CITY_LANDING.x, CITY_LANDING.z),
  yaw: 0,
  pitch: 0.065,
};
const groundEye = CITY_DECK + 0.00172;
const worldUp = new THREE.Vector3(0, 1, 0);
const cameraMatrix = new THREE.Matrix4();
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const scrollPixelsPerStop = 250;
const maximumStopsPerSecond = 0.82;
const sunStop = solarRoute.indexOf("sun");

function pose() {
  return { position: new THREE.Vector3(), rotation: new THREE.Quaternion() };
}

function stationReflections(renderer: THREE.WebGLRenderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x424a52);
  const panel = new THREE.PlaneGeometry();
  const softboxes = [
    { position: [-3.5, 5.4, 6], size: [3.7, 2.8], color: 0xfff0d5, intensity: 5.1 },
    { position: [6.4, 0.9, 1.8], size: [5.4, 2.2], color: 0xc4d9e3, intensity: 1.4 },
    { position: [1, -4.7, -4.9], size: [5, 2.5], color: 0xbcc6d0, intensity: 0.92 },
  ];
  const cards = softboxes.map(({ position, size, color, intensity }) => {
    const card = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      toneMapped: false,
    }));
    card.position.set(position[0], position[1], position[2]);
    card.scale.set(size[0], size[1], 1);
    card.lookAt(0, 0, 0);
    studio.add(card);
    return card;
  });
  const generator = new THREE.PMREMGenerator(renderer);
  const reflection = generator.fromScene(studio, 0.045, 0.1, 20, { size: 128 });
  generator.dispose();
  panel.dispose();
  for (const card of cards) card.material.dispose();
  return reflection;
}

export async function startFlight({
  host,
  initialDestination,
  initialView,
  onGraphics,
  onProgress,
  allowControls,
  onSelectBody,
  onRouteStop,
}: {
  host: HTMLElement;
  initialDestination: Destination;
  initialView: View;
  onGraphics: (available: boolean) => void;
  /** Warm-up progress from 0 to 1, with a short label for the current step. */
  onProgress?: (fraction: number, label: string) => void;
  allowControls: () => boolean;
  onSelectBody: (destination: Destination) => void;
  onRouteStop: (destination: SolarDestination) => void;
}) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x03050a);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  const post = createPost(renderer);

  // Everything that feeds a shader's cache key is fixed for the whole session:
  // the fog object, each material's clipping-plane count, the lights in the
  // scene and which of them cast shadows. Views differ only in numbers (fog
  // density, plane distance, light and shadow intensity), so changing view
  // never recompiles a shader.
  const scene = new THREE.Scene();
  const atmosphere = new THREE.FogExp2(0x85989a, 0);
  scene.fog = atmosphere;
  let reflection: THREE.WebGLRenderTarget | undefined;
  scene.environmentIntensity = 0.71;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.012, 450);
  const invalidate = () => {
    dirty = true;
  };
  const upload = (texture: THREE.Texture) => renderer.initTexture(texture);
  const entryGroup = warmGroup(initialDestination);
  const atlas = createAtlas(invalidate, upload);
  const stars = makeStarField();
  const sky = makeSkyDome(invalidate, upload);
  // Start downloads now so decoding overlaps the station build.
  void sky.load().catch(() => {});
  atlas.preload(entryGroup === "system" ? "system" : "station");
  const station = await createStation((fraction, label) =>
    onProgress?.(fraction * 0.5, label),
  );
  const cutPlane = new THREE.Plane();
  const cutNowhere = new THREE.Vector3(0, 1, 0);
  cutPlane.set(cutNowhere, 1e6);
  station.landscape.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.material instanceof THREE.Material
    ) {
      object.material.clippingPlanes = [cutPlane];
    }
  });
  station.visuals.visible = false;
  const emissives = new Map<THREE.MeshBasicMaterial, THREE.Color>();
  station.visuals.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.material instanceof THREE.MeshBasicMaterial &&
      !object.material.toneMapped
    ) {
      emissives.set(object.material, object.material.color.clone());
    }
  });
  const ambient = new THREE.HemisphereLight(0xd4e8ff, 0x384451, 1.3);
  scene.add(
    sky.mesh,
    stars.mesh,
    atlas.root,
    station.root,
    ambient,
  );

  const sun = new THREE.DirectionalLight(0xf4e2d4, 3.22);
  sun.position.set(-5, 8, 9);
  sun.shadow.mapSize.set(2048, 2048); // resized per quality tier in applyTier
  sun.shadow.camera.left = sun.shadow.camera.bottom = -9.6;
  sun.shadow.camera.right = sun.shadow.camera.top = 9.6;
  sun.shadow.camera.near = 0.4;
  sun.shadow.camera.far = 26;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00016;
  sun.shadow.normalBias = 0.008;
  sun.shadow.autoUpdate = false;
  sun.castShadow = true;
  sun.shadow.intensity = 0;
  const bounce = new THREE.DirectionalLight(0x9fc7ff, 1.04);
  bounce.position.set(5, -2, -8);
  const interior = new THREE.PointLight(0xffe5c5, 0, 18, 1.64);
  interior.position.set(0, 0, -0.24);
  const daylight = new THREE.DirectionalLight(0xffebcd, 0);
  daylight.position.set(0.23, -0.1, 1.7);
  daylight.target.position.copy(cityPoint(0, 0.62));
  daylight.shadow.mapSize.set(1024, 1024);
  daylight.shadow.camera.near = 0.1;
  daylight.shadow.camera.far = 5.3;
  daylight.shadow.bias = -0.000036;
  daylight.shadow.normalBias = 0.00013;
  daylight.shadow.autoUpdate = false;
  daylight.castShadow = true;
  daylight.shadow.intensity = 0;
  let cityShadows = false;
  station.spin.add(interior, daylight, daylight.target);
  scene.add(sun, bounce);

  const desired = pose();
  const legStart = pose();
  const legEnd = pose();
  const focus = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  const approach = new THREE.Vector3();
  const wheelGate = new THREE.Vector3();
  const doorway = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const departureOrbit = new THREE.Spherical();
  const approachOrbit = new THREE.Spherical();
  const approachRotation = new THREE.Quaternion();
  const dockAxis = new THREE.Vector3(0, 0, 1).applyEuler(station.root.rotation);
  daylight.shadow.camera.up.copy(dockAxis);
  const dockHeading = Math.atan2(dockAxis.x, dockAxis.z);
  const localCamera = new THREE.Vector3();
  const cutNormal = new THREE.Vector3();
  const rootRotation = new THREE.Quaternion();
  const pointers = new Map<number, { x: number; y: number; travel: number }>();
  const keys = new Set<string>();
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let destination: Destination = "system";
  let elapsed = 0;
  let travelProgress = 0;
  let travelTarget = 0;
  let wheelDistance = 0;
  let orbit = initialOrbit();
  let orbitTarget = { ...orbit };
  let walk = { ...flyoverStart };
  let look = { yaw: flyoverStart.yaw, pitch: flyoverStart.pitch };
  let cityTime = 0;
  let view: View = "orbital";
  let transition: Transition | null = null;
  let rpm = DEFAULT_RPM;
  let timeScale = 1;
  let playing = !motionPreference.matches;
  let dirty = true;
  let running = false;
  let available = true;
  let isCutaway = false;
  let last = performance.now();
  let viewportWidth = 1;
  let viewportHeight = 1;
  let maximumRatio = 1;
  let lastDraw = 0;
  let displayInterval = 16.7;
  let lastSunAngle = Infinity;

  // Quality follows measured load. Real GPU timings are used where the browser
  // exposes them; otherwise load is inferred from the time between frames.
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const GPU_BUDGET_MS = 11;
  /** Dev only: raw GPU milliseconds per timed frame, read by scripts/bench.js. */
  const gpuSamples: number[] = [];
  let gpuQuery: WebGLQuery | null = null;
  let gpuQueryOpen = false;
  const governor = createGovernor({
    initial:
      matchMedia("(pointer: coarse)").matches ||
      (navigator.hardwareConcurrency ?? 8) <= 4
        ? "balanced"
        : "high",
    upThreshold: timer ? 0.5 : 0.95,
  });
  let quality = tierSettings[governor.tier];
  let lastDaylightAngle = Infinity;

  function initialOrbit(): Orbit {
    if (isSolarDestination(destination)) return { yaw: 0, pitch: 0, zoom: 1 };
    switch (destination) {
      case "galaxy":
        return { yaw: -0.3, pitch: 1.02, zoom: 1 };
      case "blackhole":
        return { yaw: -0.14, pitch: 0.13, zoom: 1 };
      case "station":
        return { ...defaultOrbit[isHabitatView(view) ? "orbital" : view] };
      default:
        return { yaw: 0.17, pitch: 0.22, zoom: 1 };
    }
  }

  function orbitDistance() {
    const aspect = viewportWidth / viewportHeight;
    switch (destination) {
      case "galaxy":
        return 31.5 * Math.max(1, 0.91 / aspect);
      case "blackhole":
        return 21 * Math.max(1, 0.75 / aspect);
      case "station":
        return (view === "cutaway" ? 24.6 : 25.6) * Math.max(1, 1.09 / aspect);
      default:
        return 3.77 * Math.max(1, 0.69 / aspect);
    }
  }

  function setDestination(next: Destination) {
    const wasSolar = isSolarDestination(destination);
    const nextSolar = isSolarDestination(next);
    const nextStop = nextSolar ? solarRoute.indexOf(next) : 0;
    if (
      destination === next &&
      (!nextSolar || (travelProgress === nextStop && travelTarget === nextStop))
    )
      return;
    const movingWithinSystem = wasSolar && nextSolar;
    transition =
      movingWithinSystem && !motionPreference.matches
        ? {
            from: {
              position: camera.position.clone(),
              rotation: camera.quaternion.clone(),
            },
            elapsed: 0,
            duration: 1.15,
            route: "orbital",
          }
        : null;
    destination = next;
    view = "orbital";
    governor.discard();
    travelProgress = travelTarget = nextStop;
    wheelDistance = 0;
    keys.clear();
    setCutaway(false);
    station.visuals.visible = next === "station";
    if (!movingWithinSystem) atlas.setView(nextSolar ? "system" : next);
    orbitTarget = initialOrbit();
    orbit = {
      ...orbitTarget,
      zoom: movingWithinSystem || motionPreference.matches ? 1 : 1.45,
    };
    dirty = true;
  }

  function solarPose(stop: SolarDestination, target: Pose) {
    const aspect = viewportWidth / viewportHeight;
    let yaw = orbit.yaw + 0.07;
    let pitch = orbit.pitch + 0.17;
    let distance = 29 * Math.max(1, 0.76 / aspect);
    focus.set(0, -0.043 * distance * Math.max(orbit.zoom, 0.74), 0);
    if (stop !== "system") {
      const body = atlas.getBody(stop);
      focus.copy(body.frame.position);
      const hasVisibleRings = stop === "saturn" || stop === "uranus";
      const distanceScale = stop === "sun" ? 4.15 : hasVisibleRings ? 5.35 : 4.45;
      const minimumAspect = stop === "sun" ? 0.86 : hasVisibleRings ? 0.96 : 0.67;
      distance =
        body.frame.scale.x * distanceScale * Math.max(1, minimumAspect / aspect);
      const light = body.light;
      yaw =
        orbit.yaw +
        (stop === "sun" ? 0.12 : Math.atan2(light.x, light.z) + 1.0);
      pitch = orbit.pitch + (stop === "sun" ? 0.18 : 0.28);
    }
    pitch = clamp(pitch, -1.35, 1.35);
    distance *= stop === "system" ? Math.max(orbit.zoom, 0.74) : orbit.zoom;
    target.position.set(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    if (stop !== "system") target.position.add(focus);
    cameraMatrix.lookAt(target.position, focus, worldUp);
    target.rotation.setFromRotationMatrix(cameraMatrix);
  }

  function travelPose() {
    const index = Math.floor(travelProgress);
    const next = Math.min(index + 1, solarRoute.length - 1);
    const portion = travelProgress - index;
    solarPose(solarRoute[index], legStart);
    solarPose(solarRoute[next], legEnd);
    const eased = THREE.MathUtils.smoothstep(portion, 0, 1);
    desired.position.lerpVectors(legStart.position, legEnd.position, eased);
    const rise = Math.min(
      7,
      legStart.position.distanceTo(legEnd.position) * 0.31,
    );
    desired.position.y += Math.sin(Math.PI * eased) * rise;
    desired.rotation.slerpQuaternions(
      legStart.rotation,
      legEnd.rotation,
      eased,
    );
  }

  function targetPose() {
    if (isSolarDestination(destination)) {
      travelPose();
      return;
    }
    if (isHabitatView(view)) {
      desired.position.copy(
        terrainPoint(walk.u, walk.v, view === "ground" ? groundEye : 0.33),
      );
      const a = surfaceAngle(walk.u);
      up.set(-Math.cos(a), -Math.sin(a), 0);
      side.set(-Math.sin(a), Math.cos(a), 0);
      forward
        .set(0, 0, -Math.cos(walk.yaw))
        .addScaledVector(side, Math.sin(walk.yaw));
      forward
        .multiplyScalar(Math.cos(walk.pitch))
        .addScaledVector(up, Math.sin(walk.pitch));
      focus.copy(desired.position).add(forward);
      cameraMatrix.lookAt(desired.position, focus, up);
      desired.rotation.setFromRotationMatrix(cameraMatrix);
      station.spin.getWorldQuaternion(rootRotation);
      desired.rotation.premultiply(rootRotation);
      station.spin.localToWorld(desired.position);
    } else {
      const distance = orbit.zoom * orbitDistance();
      desired.position.set(
        Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * distance,
        Math.sin(orbit.pitch) * distance,
        Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * distance,
      );
      focus.set(
        destination === "station" ? -1.58 : 0,
        -(destination === "station" ? 0.043 : 0.024) * distance,
        0,
      );
      cameraMatrix.lookAt(desired.position, focus, worldUp);
      desired.rotation.setFromRotationMatrix(cameraMatrix);
    }
  }

  function fit() {
    viewportWidth = host.clientWidth;
    viewportHeight = host.clientHeight;
    if (!viewportWidth || !viewportHeight) return;
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
    const density = Math.sqrt(2_560_000 / (viewportWidth * viewportHeight));
    maximumRatio = Math.min(devicePixelRatio, 1.65, density);
    setRenderRatio(maximumRatio * quality.scale);
    lastDraw = 0;
    governor.discard();
    dirty = true;
  }

  function setRenderRatio(ratio: number) {
    renderer.setDrawingBufferSize(viewportWidth, viewportHeight, ratio);
    post.setSize(viewportWidth, viewportHeight, ratio);
    stars.setDensity(ratio);
  }

  /** Compiles every material for the HDR buffer or for the screen. */
  function compileFor(hdr: boolean) {
    renderer.setRenderTarget(hdr ? post.sceneTarget : null);
    const compiled = renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(null);
    return compiled;
  }

  function usePipeline() {
    post.setTier(quality);
    // Lamps and windows are authored at screen white; in the HDR buffer they
    // are pushed past 1.0 so the bloom picks them up.
    for (const [material, base] of emissives) {
      material.color.copy(base).multiplyScalar(post.hdr ? 2.2 : 1);
    }
    atlas.setHdr(post.hdr);
    dirty = true;
  }

  function applyTier(tier: Tier) {
    quality = tierSettings[tier];
    const wantHdr = post.supported && quality.hdr;
    if (!running || wantHdr === post.hdr) {
      usePipeline();
    } else {
      // Shaders differ between the HDR buffer and the screen. Build the other
      // set in the background, then switch, so changing tier does not freeze.
      const chosen = quality;
      void compileFor(wantHdr).then(() => {
        if (quality === chosen) usePipeline();
      });
    }
    setRenderRatio(maximumRatio * quality.scale);
    const size = quality.shadowSize || 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      lastSunAngle = Infinity;
    }
    lastDraw = 0;
    dirty = true;
  }

  /**
   * Feeds the governor one frame. With a timer query, load is GPU time against
   * a budget that leaves headroom inside a 60 Hz frame. Without one, it is the
   * gap between frames against the display's own rate, which is estimated as
   * the shortest gap seen recently.
   */
  function measureLoad(now: number) {
    let load: number | null = null;
    if (timer) {
      if (gpuQuery && !gpuQueryOpen) {
        if (gl.getQueryParameter(gpuQuery, gl.QUERY_RESULT_AVAILABLE)) {
          const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
          const nanoseconds = gl.getQueryParameter(gpuQuery, gl.QUERY_RESULT);
          gl.deleteQuery(gpuQuery);
          gpuQuery = null;
          if (!disjoint) load = nanoseconds / 1e6 / GPU_BUDGET_MS;
          if (import.meta.env.DEV && load !== null) gpuSamples.push(nanoseconds / 1e6);
        }
      }
    } else if (lastDraw > 0) {
      const interval = now - lastDraw;
      displayInterval = clamp(Math.min(displayInterval + 0.002, interval), 6.9, 16.7);
      load = interval / (displayInterval * 1.15);
    }
    lastDraw = now;
    if (load === null) return;
    const change = governor.sample(load, now);
    if (change) applyTier(change);
  }

  function draw() {
    const timed = timer && !gpuQuery;
    if (timed) {
      gpuQuery = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, gpuQuery!);
      gpuQueryOpen = true;
    }
    post.render(scene, camera, last / 1000);
    if (timed) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      gpuQueryOpen = false;
    }
  }

  function setCutaway(enabled: boolean) {
    if (isCutaway === enabled) return;
    isCutaway = enabled;
    if (!enabled) {
      cutPlane.set(cutNowhere, 1e6);
      for (const panel of station.removablePanels) panel.visible = true;
    }
  }

  function cutaway() {
    localCamera.copy(camera.position);
    station.spin.worldToLocal(localCamera);
    const azimuth = Math.atan2(localCamera.x, -localCamera.y);
    station.removablePanels.forEach((panel, index) => {
      const sector = ((index + 0.5) * TAU) / station.removablePanels.length;
      panel.visible = Math.cos(sector - azimuth) < 0.37;
    });
    cutNormal.set(-localCamera.x, -localCamera.y, 0).normalize();
    station.spin.getWorldQuaternion(rootRotation);
    cutNormal.applyQuaternion(rootRotation);
    cutPlane.set(cutNormal, 0.54);
  }

  function setView(next: View) {
    if (destination !== "station" || view === next) return;
    const route =
      next === "ground" && isHabitatView(view)
        ? "landing"
        : next === "habitat" && view === "ground"
          ? "takeoff"
          : isHabitatView(next)
            ? "inbound"
            : isHabitatView(view)
              ? "outbound"
              : "orbital";
    transition = motionPreference.matches
      ? null
      : {
          from: {
            position: camera.position.clone(),
            rotation: camera.quaternion.clone(),
          },
          elapsed: 0,
          duration: route === "orbital" ? 1.35
            : route === "inbound" || route === "outbound" ? 3.1 : 2.65,
          route,
        };
    view = next;
    keys.clear();
    governor.discard();
    if (isHabitatView(next)) {
      walk = { ...(next === "ground" ? groundStart : flyoverStart) };
      look = { yaw: walk.yaw, pitch: walk.pitch };
    } else {
      orbit = { ...defaultOrbit[next] };
      orbitTarget = { ...orbit };
    }
    setCutaway(next === "cutaway");
    dirty = true;
  }

  function reset() {
    if (isHabitatView(view)) {
      walk = { ...(view === "ground" ? groundStart : flyoverStart) };
      look = { yaw: walk.yaw, pitch: walk.pitch };
      transition = null;
    } else {
      orbitTarget = initialOrbit();
      if (motionPreference.matches) orbit = { ...orbitTarget };
    }
    dirty = true;
  }

  function move(key: string, held: boolean) {
    if (held) keys.add(key);
    else keys.delete(key);
    dirty = true;
  }

  function aim(x: number, y: number) {
    if (isHabitatView(view)) {
      look.yaw -= x;
      look.pitch = clamp(look.pitch + y, -1.26, 1.38);
    } else {
      orbitTarget.yaw -= x;
      orbitTarget.pitch = clamp(orbitTarget.pitch + y, -1.23, 1.23);
    }
    dirty = true;
  }

  function zoom(factor: number) {
    if (isHabitatView(view)) return;
    orbitTarget.zoom = clamp(
      orbitTarget.zoom * factor,
      destination === "system" ? 0.74 : destination === "station" ? 0.44 : 0.39,
      2.6,
    );
    dirty = true;
  }

  function moveAcross(forward: number, lateral: number, seconds: number) {
    const speed =
      ((view === "ground" ? 0.007 : 0.46) * seconds) /
      Math.max(1, Math.hypot(forward, lateral));
    const across =
      (Math.sin(walk.yaw) * forward + Math.cos(walk.yaw) * lateral) * speed;
    const along =
      (Math.cos(walk.yaw) * forward - Math.sin(walk.yaw) * lateral) * speed;
    if (view === "ground") {
      const position = cityCoordinates(walk.u, walk.v);
      if (station.city.canWalk(position.x + across, position.z))
        position.x += across;
      if (station.city.canWalk(position.x, position.z - along))
        position.z -= along;
      const point = citySurface(position.x, position.z);
      walk.u = point.u;
      walk.v = point.v;
      return;
    }
    walk.v = clamp(walk.v - along / (HALF_LENGTH * 2), 0.04, 0.96);
    walk.u = THREE.MathUtils.euclideanModulo(
      walk.u + across / (RADIUS * TAU),
      1,
    );
  }

  function stepControls(delta: number) {
    const key = (code: string) => Number(keys.has(code));
    aim(
      (key("ArrowLeft") - key("ArrowRight")) * delta * 1.4,
      (key("ArrowUp") - key("ArrowDown")) * delta * 1.4,
    );
    if (isHabitatView(view)) {
      moveAcross(key("KeyW") - key("KeyS"), key("KeyD") - key("KeyA"), delta);
    }
  }

  function flyThroughDock(progress: number, orbital: Pose, habitat: Pose) {
    station.spin.localToWorld(approach.copy(station.entryPath.approach));
    const approachEnd = 0.44;
    if (progress < approachEnd) {
      const t = THREE.MathUtils.smootherstep(progress, 0, approachEnd);
      departureOrbit.setFromVector3(orbital.position);
      approachOrbit.setFromVector3(approach);
      const approachArc = THREE.MathUtils.euclideanModulo(
        dockHeading - departureOrbit.theta + Math.PI, TAU,
      ) - Math.PI;
      const gateOffset = THREE.MathUtils.euclideanModulo(
        approachOrbit.theta - dockHeading + Math.PI, TAU,
      ) - Math.PI;
      camera.position.setFromSphericalCoords(
        THREE.MathUtils.lerp(departureOrbit.radius, approachOrbit.radius, t),
        THREE.MathUtils.lerp(departureOrbit.phi, approachOrbit.phi, t),
        departureOrbit.theta + (approachArc + gateOffset) * t,
      );
      cameraMatrix.lookAt(camera.position, origin, worldUp);
      approachRotation.setFromRotationMatrix(cameraMatrix);
      camera.quaternion.slerpQuaternions(orbital.rotation, approachRotation, THREE.MathUtils.smoothstep(t, 0, 0.54));
      return;
    }

    const t = THREE.MathUtils.smootherstep(progress, approachEnd, 1);
    const s = 1 - t;
    station.spin.localToWorld(wheelGate.copy(station.entryPath.wheel));
    station.spin.localToWorld(doorway.copy(station.entryPath.interior));
    camera.position
      .copy(approach)
      .multiplyScalar(s ** 3)
      .addScaledVector(wheelGate, 3 * s * s * t)
      .addScaledVector(doorway, 3 * s * t * t)
      .addScaledVector(habitat.position, t ** 3);
    cameraMatrix.lookAt(approach, origin, worldUp);
    approachRotation.setFromRotationMatrix(cameraMatrix);
    camera.quaternion.slerpQuaternions(approachRotation, habitat.rotation, t);
  }

  function applyCamera(delta: number) {
    targetPose();
    if (!transition) {
      camera.position.copy(desired.position);
      camera.quaternion.copy(desired.rotation);
      return;
    }
    transition.elapsed += delta;
    const t = clamp(transition.elapsed / transition.duration, 0, 1);
    const eased = THREE.MathUtils.smootherstep(t, 0, 1);
    const { from, route } = transition;
    if (route === "inbound" || route === "outbound") {
      if (route === "inbound") flyThroughDock(t, from, desired);
      else flyThroughDock(1 - t, desired, from);
      if (t === 1) transition = null;
      return;
    }
    if (route === "landing" || route === "takeoff") {
      station.spin.localToWorld(approach.copy(cityPoint(CITY_LANDING.x, CITY_LANDING.z + 0.23, 0.31)));
      station.spin.localToWorld(doorway.copy(cityPoint(CITY_LANDING.x, CITY_LANDING.z + 0.048, 0.014)));
      const landing = route === "landing";
      const s = 1 - eased;
      camera.position
        .copy(from.position)
        .multiplyScalar(s ** 3)
        .addScaledVector(landing ? approach : doorway, 3 * s * s * eased)
        .addScaledVector(landing ? doorway : approach, 3 * s * eased * eased)
        .addScaledVector(desired.position, eased ** 3);
    } else {
      camera.position.lerpVectors(from.position, desired.position, eased);
    }
    camera.quaternion.slerpQuaternions(from.rotation, desired.rotation, eased);
    if (t === 1) transition = null;
  }

  function interpolate(value: number, target: number, delta: number) {
    if (Math.abs(value - target) < 0.0001 || motionPreference.matches)
      return target;
    return damp(value, target, 13, delta);
  }

  function frame(now: number) {
    const frameSeconds = Math.max(0, (now - last) / 1000);
    const delta = Math.min(frameSeconds, 0.06);
    last = now;
    if (!available || document.hidden) {
      lastDraw = 0;
      return;
    }
    const spinning = destination === "station" && playing && rpm > 0;
    const animateSpace = destination !== "station" && !motionPreference.matches;
    const animateCity =
      (isHabitatView(view) || view === "cutaway") && !motionPreference.matches;
    if (animateCity) {
      cityTime += delta;
      station.city.update(cityTime);
    }
    if (animateSpace) elapsed += delta;
    const flying = travelProgress !== travelTarget;
    if (flying) {
      const limit = maximumStopsPerSecond * delta;
      const step =
        damp(travelProgress, travelTarget, 2.8, delta) - travelProgress;
      travelProgress =
        motionPreference.matches ||
        Math.abs(travelProgress - travelTarget) < 0.004
          ? travelTarget
          : travelProgress + clamp(step, -limit, limit);
      const stop = solarRoute[travelTarget];
      if (
        Math.abs(travelProgress - travelTarget) <= 0.02 &&
        destination !== stop
      ) {
        destination = stop;
        onRouteStop(stop);
      }
    }
    const moving = isHabitatView(view)
      ? walk.yaw !== look.yaw || walk.pitch !== look.pitch
      : orbit.yaw !== orbitTarget.yaw ||
        orbit.pitch !== orbitTarget.pitch ||
        orbit.zoom !== orbitTarget.zoom;
    if (
      !dirty &&
      !spinning &&
      !moving &&
      !transition &&
      !keys.size &&
      !animateSpace &&
      !animateCity &&
      !flying
    ) {
      // Nothing to draw: gaps between frames no longer say anything about load.
      lastDraw = 0;
      governor.discard();
      return;
    }
    if (keys.size && !transition && allowControls()) stepControls(delta);
    orbit.yaw = interpolate(orbit.yaw, orbitTarget.yaw, delta);
    orbit.pitch = interpolate(orbit.pitch, orbitTarget.pitch, delta);
    orbit.zoom = interpolate(orbit.zoom, orbitTarget.zoom, delta);
    walk.yaw = interpolate(walk.yaw, look.yaw, delta);
    walk.pitch = interpolate(walk.pitch, look.pitch, delta);
    if (spinning) {
      station.spin.rotation.z =
        (station.spin.rotation.z + radiansPerSecond(rpm) * delta * timeScale) %
        TAU;
    }
    atlas.update(elapsed);
    applyCamera(Math.min(frameSeconds, 0.25));
    if (isCutaway) cutaway();
    let habitatLight = Number(isHabitatView(view));
    if (transition?.route === "inbound" || transition?.route === "outbound") {
      station.root.worldToLocal(localCamera.copy(camera.position));
      habitatLight =
        (1 - THREE.MathUtils.smoothstep(Math.abs(localCamera.z), HALF_LENGTH - 0.1, HALF_LENGTH + 1.64)) *
        (1 - THREE.MathUtils.smoothstep(Math.hypot(localCamera.x, localCamera.y), RADIUS - 0.04, RADIUS + 0.24));
    }
    const inside = habitatLight > 0.53;
    const fov = interpolate(
      camera.fov,
      viewFov(view, inside),
      delta,
    );
    const near = view === "ground" ? 0.00048 : 0.012;
    const far = view === "ground" ? 80 : 450;
    if (camera.fov !== fov || camera.near !== near) {
      camera.fov = fov;
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
      dirty = true;
    }
    atmosphere.density = habitatLight * 0.069;
    measureLoad(now);
    const detailedLighting = quality.shadowSize > 0;
    const sunShadows =
      detailedLighting && destination === "station" && !inside && !isCutaway;
    sun.shadow.intensity = sunShadows ? 1 : 0;
    const spinAngle = station.spin.rotation.z;
    if (sunShadows) {
      // Refresh on every frame the station turns. A refresh every few frames
      // makes frame cost alternate, which reads as stutter on slower machines.
      if (spinAngle !== lastSunAngle) {
        sun.shadow.needsUpdate = true;
        lastSunAngle = spinAngle;
      }
    }
    if (destination === "station") {
      ambient.intensity = isCutaway ? 1.05 : THREE.MathUtils.lerp(0.59, 1.05, habitatLight);
      sun.intensity = THREE.MathUtils.lerp(3.35, 0.48, habitatLight);
      bounce.intensity = detailedLighting
        ? THREE.MathUtils.lerp(0.82, 0.34, habitatLight)
        : 0;
      interior.intensity = isCutaway ? 20 : THREE.MathUtils.lerp(11, 20, habitatLight);
      daylight.intensity = 1.42 * habitatLight;
      const extent = view === "ground" ? 0.28 : 1.19;
      const shadow = daylight.shadow.camera;
      if (shadow.right !== extent) {
        shadow.left = shadow.bottom = -extent;
        shadow.right = shadow.top = extent;
        shadow.updateProjectionMatrix();
        daylight.shadow.needsUpdate = true;
      }
      const wantCityShadows = inside && detailedLighting;
      if (wantCityShadows !== cityShadows) {
        cityShadows = wantCityShadows;
        daylight.shadow.intensity = cityShadows ? 1 : 0;
        station.city.setShadowCasting(cityShadows);
        daylight.shadow.needsUpdate = cityShadows;
      }
      if (cityShadows && !daylight.shadow.needsUpdate && spinAngle !== lastDaylightAngle) {
        // The city and its light rotate together, so only the projection moves.
        daylight.updateWorldMatrix(true, false);
        daylight.target.updateWorldMatrix(true, false);
        daylight.shadow.updateMatrices(daylight);
      }
      lastDaylightAngle = spinAngle;
    } else {
      ambient.intensity = 1.3;
      sun.intensity = 3.22;
      bounce.intensity = 1.04;
    }
    sky.mesh.position.copy(camera.position);
    const sunApproach = 1 - THREE.MathUtils.smoothstep(
      Math.abs(travelProgress - sunStop),
      0,
      1,
    );
    sky.setExposure(
      destination === "galaxy"
        ? 0.13
        : destination === "blackhole"
          ? 0.2
          : destination === "station"
            ? 0.17
            : THREE.MathUtils.lerp(0.31, 0.065, sunApproach),
    );
    stars.mesh.position.copy(camera.position);
    stars.mesh.visible = !inside;
    atlas.faceCamera(camera, elapsed);
    draw();
    dirty = false;
  }

  function advanceSolarRoute(direction: number) {
    if (transition || Math.abs(travelProgress - travelTarget) > 0.02) return;
    const next = clamp(
      travelTarget + Math.sign(direction),
      0,
      solarRoute.length - 1,
    );
    if (travelTarget === next) return;
    travelTarget = next;
    orbitTarget = initialOrbit();
  }

  const orbitKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  const walkKeys = ["KeyW", "KeyA", "KeyS", "KeyD"];
  window.addEventListener("keydown", (event) => {
    if (!allowControls() || !(event.target instanceof HTMLElement)) return;
    if (
      event.target.closest("button, input, dialog") &&
      !walkKeys.includes(event.code)
    )
      return;
    if (
      isSolarDestination(destination) &&
      (event.code === "PageDown" || event.code === "PageUp")
    ) {
      event.preventDefault();
      advanceSolarRoute(event.code === "PageDown" ? 1 : -1);
      wheelDistance = 0;
      return;
    }
    if (
      !isHabitatView(view) &&
      (event.key === "+" || event.key === "=" || event.key === "-")
    ) {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      zoom(event.key === "-" ? 1.25 : 0.8);
      return;
    }
    if (
      orbitKeys.includes(event.code) ||
      (isHabitatView(view) && walkKeys.includes(event.code))
    ) {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      move(event.code, true);
    }
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => {
    keys.clear();
    pointers.clear();
  });
  document.addEventListener("visibilitychange", () => {
    keys.clear();
    last = performance.now();
    lastDraw = 0;
    governor.discard();
    dirty = true;
  });
  host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    host.focus({ preventScroll: true });
    host.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      travel: 0,
    });
    if (pointers.size > 1) {
      for (const pointer of pointers.values()) pointer.travel = Infinity;
    }
  });
  host.addEventListener("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = {
      x: event.clientX,
      y: event.clientY,
      travel:
        previous.travel +
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y),
    };
    if (pointers.size === 1) {
      aim((next.x - previous.x) * 0.005, (next.y - previous.y) * 0.005);
    } else {
      const other = [...pointers.entries()].find(
        ([id]) => id !== event.pointerId,
      )?.[1];
      if (other) {
        const oldDistance = Math.hypot(
          previous.x - other.x,
          previous.y - other.y,
        );
        const newDistance = Math.hypot(next.x - other.x, next.y - other.y);
        zoom(Math.max(10, oldDistance) / Math.max(10, newDistance));
      }
    }
    pointers.set(event.pointerId, next);
  });
  host.addEventListener("pointerup", (event) => {
    const pointer = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (destination !== "system" || !pointer || pointer.travel > 6) return;
    const bounds = host.getBoundingClientRect();
    const target = atlas.pickBody(
      camera,
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    );
    if (target) onSelectBody(target);
  });
  for (const name of ["pointercancel", "lostpointercapture"] as const) {
    host.addEventListener(name, (event) => pointers.delete(event.pointerId));
  }
  host.addEventListener(
    "wheel",
    (event) => {
      if (isHabitatView(view)) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 36
          : event.deltaMode === 2
            ? viewportHeight
            : 1);
      if (
        isSolarDestination(destination) &&
        !event.ctrlKey &&
        !event.shiftKey &&
        Math.abs(delta) >= Math.abs(event.deltaX)
      ) {
        if (transition || Math.abs(travelProgress - travelTarget) > 0.02)
          return;
        if (wheelDistance * delta < 0) wheelDistance = 0;
        wheelDistance += clamp(
          delta,
          -scrollPixelsPerStop,
          scrollPixelsPerStop,
        );
        const stops = Math.trunc(wheelDistance / scrollPixelsPerStop);
        if (stops !== 0) {
          advanceSolarRoute(stops);
          wheelDistance %= scrollPixelsPerStop;
        }
      } else {
        zoom(Math.exp(clamp(delta, -140, 140) * 0.0015));
      }
    },
    { passive: false },
  );
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    available = false;
    onGraphics(false);
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    lastSunAngle = Infinity;
    gpuQuery = null;
    gpuQueryOpen = false;
    daylight.shadow.needsUpdate = true;
    reflection?.dispose();
    reflection = stationReflections(renderer);
    scene.environment = reflection.texture;
    available = true;
    dirty = true;
    onGraphics(true);
  });
  host.append(renderer.domElement);
  new ResizeObserver(fit).observe(host);
  fit();
  applyTier(governor.tier);
  setDestination(initialDestination);
  setView(initialView);
  transition = null;
  orbit = { ...orbitTarget };
  camera.fov = viewFov(initialView);
  camera.updateProjectionMatrix();

  /**
   * Draws one frame with every group showing and both shadow maps refreshed.
   * Compiling a shader is not enough: the driver builds its pipeline state and
   * uploads vertex buffers on first draw, so draw everything once up front.
   */
  function warmFrame() {
    const position = camera.position.clone();
    const rotation = camera.quaternion.clone();
    const { near, far } = camera;
    const stationShown = station.visuals.visible;
    station.visuals.visible = true;
    station.city.setShadowCasting(true);
    sun.shadow.needsUpdate = daylight.shadow.needsUpdate = true;
    // Trees swap in detailed models up close; draw every level now, or the
    // detailed ones are first drawn (and their shadow shaders built) mid-landing.
    const detailLevels: THREE.LOD[] = [];
    station.visuals.traverse((object) => {
      if (!(object instanceof THREE.LOD)) return;
      detailLevels.push(object);
      object.autoUpdate = false;
      for (const level of object.levels) level.object.visible = true;
    });
    camera.position.set(0, 60, 220);
    camera.lookAt(0, 0, 0);
    camera.near = 1;
    camera.far = 2000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    atlas.warm(() => post.render(scene, camera, 0));
    for (const lod of detailLevels) lod.autoUpdate = true;
    station.visuals.visible = stationShown;
    station.city.setShadowCasting(cityShadows);
    camera.position.copy(position);
    camera.quaternion.copy(rotation);
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    lastSunAngle = Infinity;
    dirty = true;
  }

  const optics = "Preparing optics";
  const entryStages: Stage[] = [
    {
      label: "Loading star catalogue",
      weight: 2,
      optional: true,
      run: () => sky.load(),
    },
    ...atlas.textureStages(entryGroup === "system" ? "system" : "station"),
    {
      label: optics,
      weight: 2,
      run() {
        reflection = stationReflections(renderer);
        scene.environment = reflection.texture;
      },
    },
    {
      label: optics,
      weight: 6,
      // Compiles every material in the scene, shown or hidden, in parallel
      // where the browser supports it.
      run: async () => void (await compileFor(post.hdr)),
    },
    { label: optics, weight: 3, run: warmFrame },
  ];
  await runStages(entryStages, (fraction, label) =>
    onProgress?.(0.5 + fraction * 0.5, label),
  );

  // Groups the visitor did not enter through only lack their image maps;
  // fetch and upload those one per slice while the first scene is on screen.
  const warmed = new Map<WarmGroup, Promise<void>>();
  let chain = Promise.resolve();
  for (const group of warmOrder(initialDestination)) {
    const stages = group === "system" ? atlas.textureStages("system") : [];
    chain = chain
      .then(() =>
        runStages(stages, () => {}, async () => {
          // An upload just ran on this thread; do not let it look like load.
          governor.discard();
          await macrotask();
        }),
      )
      .catch(() => {});
    warmed.set(group, chain);
  }

  // Handles for scripts/bench.js; stripped from production builds.
  if (import.meta.env.DEV) {
    Object.assign(window, { __post: post, __renderer: renderer, __gpuSamples: gpuSamples });
  }
  running = true;
  last = performance.now();
  frame(last);
  renderer.setAnimationLoop(frame);
  onGraphics(true);

  return {
    /** Resolves once a destination group can be shown without a hitch. */
    whenWarm: (group: WarmGroup) => warmed.get(group) ?? Promise.resolve(),
    /** Pins a quality tier, or returns control to the governor with "auto". */
    setQuality(next: Tier | "auto") {
      const change = governor.pin(next);
      if (change) applyTier(change);
    },
    get quality() {
      return governor.tier;
    },
    setDestination,
    setView,
    zoom,
    reset,
    move,
    nudge(key: string) {
      if (!isHabitatView(view) || transition) return;
      moveAcross(
        Number(key === "KeyW") - Number(key === "KeyS"),
        Number(key === "KeyD") - Number(key === "KeyA"),
        0.24,
      );
      dirty = true;
    },
    setSpin(nextRpm: number, multiplier: number, active: boolean) {
      rpm = nextRpm;
      timeScale = multiplier;
      playing = active;
      dirty = true;
    },
  };
}
