import * as THREE from "three";
import { createAtlas } from "./atlas";
import { HORIZON_RADIUS } from "./black-hole";
import {
  isSolarDestination,
  solarRoute,
  type Destination,
  type SolarDestination,
  type View,
} from "./destinations";
import { makeSkyDome, makeStarField } from "./environment";
import { DEFAULT_SOLAR_RATE, timeRates } from "./bodies-data";
import { attachInput, type Action } from "./input";
import { stepSpring, type Spring } from "./spring";
import { DEFAULT_RPM, daysSinceJ2000, radiansPerSecond } from "./physics";
import { createPost } from "./post";
import {
  createGovernor,
  createPacer,
  tierSettings,
  type Tier,
} from "./quality";
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
const FLY_HEIGHT = 0.33;
/** Seconds for a sprung value to close half its gap. */
const TURN_HALF_LIFE = 0.07;
const ZOOM_HALF_LIFE = 0.12;
const ARRIVAL_HALF_LIFE = 0.5;
const WARP_HALF_SECONDS = 0.6;
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

export type Telemetry = {
  /** Camera distance from Gargantua, in Schwarzschild radii. */
  cameraRadiusInRs: number;
  /** Simulation date, in days since J2000. */
  simDays: number;
  /** Where to draw each name label, in CSS pixels from the view's top left. */
  labels: { id: string; x: number; y: number; visible: boolean }[];
};

const labelled = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
] as const;

export async function startFlight({
  host,
  initialDestination,
  initialView,
  onGraphics,
  onProgress,
  onFrame,
  onAction,
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
  /** Called after every drawn frame with figures and label positions for the HUD. */
  onFrame?: (telemetry: Telemetry) => void;
  /** Keyboard shortcuts that belong to the HUD rather than the camera. */
  onAction?: (action: Exclude<Action, "reset">) => void;
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
  const sky = makeSkyDome(invalidate, upload);
  const atlas = createAtlas(invalidate, upload, sky);
  const stars = makeStarField();
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
  const keys = new Set<string>();
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let destination: Destination = "system";
  let elapsed = 0;
  let travelProgress = 0;
  let travelTarget = 0;
  let overscroll = 0;
  let idleSeconds = 0;
  // True from arrival until the view has settled or the visitor takes over;
  // while it is, the camera eases in slowly from a wider, offset start.
  let settling = false;
  let flyHeight = FLY_HEIGHT;
  const stick = { x: 0, y: 0 };
  /** Drag momentum, in the same units `aim` takes, per second. */
  const coast = { x: 0, y: 0 };
  const orbitVelocity = { yaw: 0, pitch: 0, zoom: 0 };
  const lookVelocity = { yaw: 0, pitch: 0 };
  const fovSpring: Spring = { value: 42, velocity: 0 };
  const scratch: Spring = { value: 0, velocity: 0 };
  let warp: {
    elapsed: number;
    next: Destination;
    swapped: boolean;
    ready: boolean;
  } | null = null;
  let fade = 0;
  let guidesShown = true;
  const telemetry: Telemetry = {
    cameraRadiusInRs: 0,
    simDays: 0,
    labels: [...labelled, "sol"].map((id) => ({ id, x: 0, y: 0, visible: false })),
  };
  const projected = new THREE.Vector3();
  const warmed = new Map<WarmGroup, Promise<void>>();
  /** Resolves once a destination group can be shown without a hitch. */
  const whenWarm = (group: WarmGroup) => warmed.get(group) ?? Promise.resolve();
  let orbit = initialOrbit();
  let orbitTarget = { ...orbit };
  let walk = { ...flyoverStart };
  let look = { yaw: flyoverStart.yaw, pitch: flyoverStart.pitch };
  let cityTime = 0;
  let view: View = "orbital";
  let transition: Transition | null = null;
  let rpm = DEFAULT_RPM;
  let timeScale = 1;
  // The simulation clock starts now and runs at `solarRate` seconds per second.
  let simDays = daysSinceJ2000(new Date());
  let spinHours = 0;
  let solarRate = timeRates.solar[DEFAULT_SOLAR_RATE];
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
  const pacer = createPacer();
  let lastSunAngle = Infinity;

  // Quality follows measured load. Real GPU timings are used where the browser
  // exposes them; otherwise load is inferred from the time between frames.
  const gl = renderer.getContext() as WebGL2RenderingContext;
  type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  const timerName = "EXT_disjoint_timer_query_webgl2";
  let timer = gl.getExtension(timerName) as TimerExtension | null;
  const GPU_BUDGET_MS = 11;
  /** Dev only: raw GPU milliseconds per timed frame, read by scripts/bench.js. */
  const gpuSamples: number[] = [];
  let gpuQuery: WebGLQuery | null = null;
  let gpuQueryOpen = false;
  /** Latest GPU time as a share of the budget; 1 until first measured. */
  let gpuLoad = 1;
  const governor = createGovernor({
    initial:
      matchMedia("(pointer: coarse)").matches ||
      (navigator.hardwareConcurrency ?? 8) <= 4
        ? "balanced"
        : "high",
    upThreshold: 0.5,
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
        // About 25 Schwarzschild radii out, where the whole disk fits the view.
        return 25 * HORIZON_RADIUS * Math.max(1, 0.75 / aspect);
      case "station":
        return (view === "cutaway" ? 24.6 : 25.6) * Math.max(1, 1.09 / aspect);
      default:
        return 3.77 * Math.max(1, 0.69 / aspect);
    }
  }

  function setDestination(next: Destination) {
    if (warp && !warp.swapped) {
      // Still on the way out: change where the jump lands.
      aimWarp(next);
      return;
    }
    const nextSolar = isSolarDestination(next);
    const nextStop = nextSolar ? solarRoute.indexOf(next) : 0;
    if (
      destination === next &&
      (!nextSolar || (travelProgress === nextStop && travelTarget === nextStop))
    )
      return;
    // Inside the Solar System the camera flies there in one continuous move.
    // Anywhere else is too far to fly, so the view jumps under a warp.
    if (!running || (isSolarDestination(destination) && nextSolar)) arrive(next);
    else {
      warp = { elapsed: 0, next, swapped: false, ready: false };
      aimWarp(next);
    }
  }

  function aimWarp(next: Destination) {
    const jump = warp;
    if (!jump) return;
    jump.next = next;
    jump.ready = false;
    // Hold the warp until the destination's maps are on the GPU.
    void whenWarm(warmGroup(next)).then(() => {
      if (warp === jump && jump.next === next) jump.ready = true;
    });
    dirty = true;
  }

  function arrive(next: Destination) {
    const nextSolar = isSolarDestination(next);
    const nextStop = nextSolar ? solarRoute.indexOf(next) : 0;
    const movingWithinSystem = isSolarDestination(destination) && nextSolar;
    transition =
      movingWithinSystem && running && !motionPreference.matches
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
    overscroll = 0;
    keys.clear();
    setCutaway(false);
    station.visuals.visible = next === "station";
    if (!movingWithinSystem) atlas.setView(nextSolar ? "system" : next);
    orbitTarget = initialOrbit();
    orbit = { ...orbitTarget };
    if (!movingWithinSystem) establish();
    dirty = true;
  }

  /** Starts wide and a little off to one side, then eases onto the subject. */
  function establish() {
    orbitVelocity.yaw = orbitVelocity.pitch = orbitVelocity.zoom = 0;
    coast.x = coast.y = 0;
    settling = running && !motionPreference.matches;
    if (settling) {
      orbit.zoom = orbitTarget.zoom * 1.45;
      orbit.yaw = orbitTarget.yaw - 0.25;
    }
  }

  function solarPose(stop: SolarDestination, target: Pose) {
    const aspect = viewportWidth / viewportHeight;
    // The overview looks sunward from just outside Saturn's orbit, wherever
    // Saturn is on the simulation date, so the rings are always the foreground.
    const saturn = atlas.getBody("saturn").frame.position;
    // Offset to the side that puts Saturn lower right, clear of the data card.
    let yaw = orbit.yaw + Math.atan2(saturn.x, saturn.z) - 0.6;
    let pitch = orbit.pitch + 0.34;
    // Pull back on tall screens so the Sun and Saturn both stay in frame.
    let distance = 21 * Math.max(1, 1.15 / aspect);
    focus.copy(saturn).multiplyScalar(0.62);
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
    target.position.add(focus);
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
        terrainPoint(walk.u, walk.v, view === "ground" ? groundEye : flyHeight),
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
    // A collapsed or hidden container reports zero. Keep the last real size:
    // a zero would turn the aspect ratio, then the camera, into NaN, and three
    // throws when it uploads a NaN clipping plane.
    if (!host.clientWidth || !host.clientHeight) return;
    viewportWidth = host.clientWidth;
    viewportHeight = host.clientHeight;
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
    atlas.setLensQuality(quality.lensSteps);
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
   * Feeds the governor one frame.
   *
   * Only missed frames count as overload: when the gap between frames is well
   * over the display's own interval, the machine is not keeping up. GPU time
   * alone is not trusted for that, because a lightly loaded GPU slows its clock
   * and the same frame can read anywhere from 3 to 8 ms. GPU time is used the
   * other way round, as evidence of headroom before stepping quality up.
   */
  function measureLoad(now: number) {
    if (timer && post.hdr && gpuQuery && !gpuQueryOpen) {
      if (gl.getQueryParameter(gpuQuery, gl.QUERY_RESULT_AVAILABLE)) {
        const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
        const milliseconds = gl.getQueryParameter(gpuQuery, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(gpuQuery);
        gpuQuery = null;
        if (!disjoint) {
          gpuLoad = milliseconds / GPU_BUDGET_MS;
          if (import.meta.env.DEV) gpuSamples.push(milliseconds);
        }
      }
    }
    const previous = lastDraw;
    lastDraw = now;
    if (previous <= 0) return;
    const behind = pacer.observe(now - previous);
    const load =
      behind <= 1.08
        ? // Keeping up. How light it is comes from the GPU timer where there is
          // one (it reads near zero on the direct path, so not there).
          Math.min(0.95, timer && post.hdr ? gpuLoad : 0.4)
        : behind < 1.3
          ? 0.99 // ordinary jitter: neither light nor overloaded
          : behind / 1.15;
    const change = governor.sample(load, now);
    if (change) applyTier(change);
  }

  function draw() {
    const timed = timer && post.hdr && !gpuQuery;
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
    flyHeight = FLY_HEIGHT;
    coast.x = coast.y = 0;
    settling = false;
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
      flyHeight = FLY_HEIGHT;
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

  function zoom(factor: number, wheel = 0) {
    if (isHabitatView(view)) return;
    const farthest = 2.6;
    const wasFarthest = orbitTarget.zoom >= farthest - 1e-3;
    orbitTarget.zoom = clamp(
      orbitTarget.zoom * factor,
      destination === "system"
        ? 0.74
        : destination === "station"
          ? 0.44
          : destination === "blackhole"
            ? 0.08 // down to 2 Schwarzschild radii
            : 0.39,
      farthest,
    );
    settling = false;
    // Scrolling out past the limit at a planet pulls back to the whole system.
    const atPlanet =
      isSolarDestination(destination) &&
      destination !== "system" &&
      travelProgress === travelTarget;
    if (wheel > 0 && wasFarthest && atPlanet && !transition) {
      overscroll += wheel;
      if (overscroll > 300) {
        overscroll = 0;
        onSelectBody("system");
      }
    } else {
      overscroll = 0;
    }
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
    if (!isHabitatView(view)) return;
    const haste = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 2 : 1;
    moveAcross(
      key("KeyW") - key("KeyS") + stick.y,
      key("KeyD") - key("KeyA") + stick.x,
      delta * haste,
    );
    if (view === "habitat") {
      flyHeight = clamp(
        flyHeight + (key("KeyE") - key("KeyQ")) * delta * 0.3 * haste,
        0.12,
        1.2,
      );
    }
  }

  /** Fills `telemetry`. Labels sit just under each body's disc. */
  function report(warpAmount: number) {
    telemetry.simDays = simDays;
    telemetry.cameraRadiusInRs = camera.position.length() / HORIZON_RADIUS;
    const show = guidesShown && warpAmount < 0.05 && !transition;
    const pixelsPerUnit =
      viewportHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    for (const label of telemetry.labels) {
      label.visible = false;
      let radius = 0;
      if (label.id === "sol") {
        if (!show || destination !== "galaxy") continue;
        atlas.sol(projected);
        radius = 0.24;
      } else {
        if (!show || destination !== "system") continue;
        const body = atlas.getBody(label.id as (typeof labelled)[number]).frame;
        projected.copy(body.position);
        radius = body.scale.x;
      }
      const distance = projected.distanceTo(camera.position);
      projected.project(camera);
      if (projected.z > 1 || Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1) {
        continue;
      }
      label.visible = true;
      label.x = (projected.x * 0.5 + 0.5) * viewportWidth;
      label.y =
        (0.5 - projected.y * 0.5) * viewportHeight +
        (radius / distance) * pixelsPerUnit +
        6;
    }
  }

  /** Any deliberate input: ends the idle drift and the arrival sweep. */
  function touched() {
    idleSeconds = 0;
    settling = false;
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

  /** Eases one value toward its target on a critically damped spring. */
  function ease<K extends string>(
    values: Record<K, number>,
    velocities: Record<K, number>,
    key: K,
    target: number,
    halfLife: number,
    delta: number,
  ) {
    scratch.value = values[key];
    scratch.velocity = velocities[key];
    stepSpring(scratch, target, motionPreference.matches ? 0 : halfLife, delta);
    const arrived =
      Math.abs(scratch.value - target) < 1e-4 && Math.abs(scratch.velocity) < 1e-3;
    values[key] = arrived ? target : scratch.value;
    velocities[key] = arrived ? 0 : scratch.velocity;
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
    if (playing) {
      simDays += (delta * solarRate) / 86_400;
      // Planets turn at up to an hour per second; beyond that they would strobe.
      spinHours += (delta * Math.min(solarRate, 3600)) / 3600;
    }
    atlas.setDate(simDays, spinHours);
    // A jump between regions: streak out, swap the scene, streak back in.
    let warpAmount = 0;
    if (warp) {
      const half = motionPreference.matches ? 0.2 : WARP_HALF_SECONDS;
      if (warp.swapped) {
        warp.elapsed += delta;
      } else {
        warp.elapsed = Math.min(warp.elapsed + delta, half);
        if (warp.elapsed >= half && warp.ready) {
          warp.swapped = true;
          arrive(warp.next);
        }
      }
      const outward = THREE.MathUtils.smoothstep(warp.elapsed, 0, half);
      warpAmount = warp.swapped
        ? 1 - THREE.MathUtils.smoothstep(warp.elapsed, half, half * 2)
        : outward;
      if (warp.swapped && warp.elapsed >= half * 2) warp = null;
    }
    // The streak lives in the HDR output pass. Without it (Low tier, or
    // reduced motion) the jump is a plain fade through black.
    const streak = post.hdr && !motionPreference.matches;
    post.setWarp(streak ? warpAmount : 0);
    const nextFade = streak ? 0 : warpAmount;
    if (nextFade !== fade) {
      fade = nextFade;
      renderer.domElement.style.opacity = String(1 - fade);
    }

    idleSeconds += delta;
    const drifting =
      idleSeconds > 20 && !isHabitatView(view) && !motionPreference.matches;
    if (drifting) orbitTarget.yaw += 0.01 * delta;
    const coasting = coast.x !== 0 || coast.y !== 0;
    if (coasting) {
      aim(coast.x * delta, coast.y * delta);
      const decay = 0.5 ** (delta / 0.35);
      coast.x *= decay;
      coast.y *= decay;
      if (Math.hypot(coast.x, coast.y) < 0.02) coast.x = coast.y = 0;
    }
    const steering = stick.x !== 0 || stick.y !== 0;

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
      !flying &&
      !warp &&
      !drifting &&
      !coasting &&
      !steering
    ) {
      // Nothing to draw: gaps between frames no longer say anything about load.
      lastDraw = 0;
      governor.discard();
      return;
    }
    if ((keys.size || steering) && !transition && allowControls()) {
      stepControls(delta);
    }
    const turn = settling ? ARRIVAL_HALF_LIFE : TURN_HALF_LIFE;
    ease(orbit, orbitVelocity, "yaw", orbitTarget.yaw, turn, delta);
    ease(orbit, orbitVelocity, "pitch", orbitTarget.pitch, turn, delta);
    ease(
      orbit,
      orbitVelocity,
      "zoom",
      orbitTarget.zoom,
      settling ? ARRIVAL_HALF_LIFE : ZOOM_HALF_LIFE,
      delta,
    );
    if (settling && orbit.zoom === orbitTarget.zoom && orbit.yaw === orbitTarget.yaw) {
      settling = false;
    }
    ease(walk, lookVelocity, "yaw", look.yaw, TURN_HALF_LIFE, delta);
    ease(walk, lookVelocity, "pitch", look.pitch, TURN_HALF_LIFE, delta);
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
    // The view widens a little at speed: mid-flight between planets, and
    // more during a warp.
    const swell = flying
      ? 6 * Math.sin(Math.PI * (travelProgress - Math.floor(travelProgress)))
      : 0;
    fovSpring.value = camera.fov;
    stepSpring(
      fovSpring,
      viewFov(view, inside) + (motionPreference.matches ? 0 : swell + warpAmount * 9),
      motionPreference.matches ? 0 : 0.2,
      delta,
    );
    const fov =
      Math.abs(fovSpring.velocity) < 1e-3 &&
      Math.abs(fovSpring.value - viewFov(view, inside)) < 1e-3
        ? viewFov(view, inside)
        : fovSpring.value;
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
    // At Gargantua the lens shader draws the sky itself, bent.
    const lensed = destination === "blackhole";
    sky.setShown(!lensed);
    stars.mesh.position.copy(camera.position);
    stars.mesh.visible = !inside && !lensed;
    atlas.faceCamera(camera, elapsed);
    draw();
    dirty = false;
    if (onFrame) {
      report(warpAmount);
      onFrame(telemetry);
    }
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
    dirty = true;
  }

  attachInput(host, {
    allow: allowControls,
    aim(dx, dy) {
      touched();
      aim(dx, dy);
    },
    release(vx, vy) {
      if (motionPreference.matches) return;
      coast.x = vx;
      coast.y = vy;
      dirty = true;
    },
    zoom(factor, wheel) {
      touched();
      zoom(factor, wheel);
    },
    tap(x, y) {
      touched();
      const target = atlas.pickBody(camera, x, y);
      if (target) onSelectBody(target);
    },
    hop(direction) {
      touched();
      if (isSolarDestination(destination)) advanceSolarRoute(direction);
    },
    key(code, held) {
      if (!held) {
        keys.delete(code);
        return false;
      }
      if (!code.startsWith("Arrow") && !isHabitatView(view)) return false;
      touched();
      move(code, true);
      return true;
    },
    action(name) {
      touched();
      if (name === "reset") reset();
      else onAction?.(name);
    },
  });
  document.addEventListener("visibilitychange", () => {
    keys.clear();
    last = performance.now();
    lastDraw = 0;
    governor.discard();
    dirty = true;
  });
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    available = false;
    onGraphics(false);
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    lastSunAngle = Infinity;
    // Extensions belong to the context that was lost; ask again.
    timer = gl.getExtension(timerName) as TimerExtension | null;
    gpuQuery = null;
    gpuQueryOpen = false;
    gpuLoad = 1;
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
  if (!isHabitatView(view)) establish();
  last = performance.now();
  frame(last);
  renderer.setAnimationLoop(frame);
  onGraphics(true);

  return {
    whenWarm,
    /** Pins a quality tier, or returns control to the governor with "auto". */
    /** Analog movement from the on-screen stick, each axis from -1 to 1. */
    setMoveVector(x: number, y: number) {
      stick.x = x;
      stick.y = y;
      if (x || y) touched();
      dirty = true;
    },
    /** Replays the wide-to-close arrival sweep, for when the view is unveiled. */
    establish() {
      if (isHabitatView(view)) return;
      orbit = { ...orbitTarget };
      establish();
      dirty = true;
    },
    hop(direction: 1 | -1) {
      touched();
      if (isSolarDestination(destination)) advanceSolarRoute(direction);
    },
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
    setSpin(nextRpm: number) {
      rpm = nextRpm;
      dirty = true;
    },
    /**
     * Time control. `stationRate` multiplies the station's spin; `solarRate`
     * is seconds of simulated time per real second for orbits and rotation.
     */
    setClock(clock: { playing: boolean; stationRate: number; solarRate: number }) {
      playing = clock.playing;
      timeScale = clock.stationRate;
      solarRate = clock.solarRate;
      dirty = true;
    },
    setGuides(visible: boolean) {
      guidesShown = visible;
      atlas.setGuides(visible);
      dirty = true;
    },
  };
}
