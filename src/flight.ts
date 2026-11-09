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
import { createStation } from "./station";
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
  orbital: { yaw: -0.03, pitch: 0.15, zoom: 1 },
  cutaway: { yaw: 0.32, pitch: 0.39, zoom: 1 },
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

export function startFlight({
  host,
  initialDestination,
  initialView,
  onGraphics,
  allowControls,
  onSelectBody,
  onRouteStop,
}: {
  host: HTMLElement;
  initialDestination: Destination;
  initialView: View;
  onGraphics: (available: boolean) => void;
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
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  const atmosphere = new THREE.FogExp2(0x758b92, 0.034);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.012, 450);
  const station = createStation();
  const cutPlane = new THREE.Plane();
  const terrainMaterials = new Set<THREE.Material>();
  station.landscape.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.material instanceof THREE.Material
    ) {
      terrainMaterials.add(object.material);
    }
  });
  const atlas = createAtlas(() => {
    dirty = true;
  });
  station.root.visible = false;
  const stars = makeStarField();
  const sky = makeSkyDome(() => {
    dirty = true;
  });
  scene.add(
    sky.mesh,
    stars.mesh,
    atlas.root,
    station.root,
    new THREE.HemisphereLight(0xd4e8ff, 0x384451, 1.3),
  );

  const sun = new THREE.DirectionalLight(0xf4e2d4, 3.22);
  sun.position.set(-5, 8, 9);
  const bounce = new THREE.DirectionalLight(0x9fc7ff, 1.04);
  bounce.position.set(5, -2, -8);
  const interior = new THREE.PointLight(0xffe6bf, 21, 17, 1.5);
  interior.position.set(0, 0, 1.4);
  station.root.add(interior);
  scene.add(sun, bounce);

  const desired = pose();
  const legStart = pose();
  const legEnd = pose();
  const focus = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  const approach = new THREE.Vector3();
  const doorway = new THREE.Vector3();
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
  let available = true;
  let isCutaway = false;
  let last = performance.now();
  let viewportWidth = 1;
  let viewportHeight = 1;

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
        return (view === "cutaway" ? 22.6 : 20.5) * Math.max(1, 0.91 / aspect);
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
    travelProgress = travelTarget = nextStop;
    wheelDistance = 0;
    keys.clear();
    setCutaway(false);
    station.root.visible = next === "station";
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
      focus.set(0, -(destination === "station" ? 0.043 : 0.024) * distance, 0);
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
    const density = Math.sqrt(5_200_000 / (viewportWidth * viewportHeight));
    const pixelRatio = Math.min(devicePixelRatio, 2.35, density);
    renderer.setPixelRatio(pixelRatio);
    stars.setDensity(pixelRatio);
    renderer.setSize(viewportWidth, viewportHeight, false);
    dirty = true;
  }

  function setCutaway(enabled: boolean) {
    if (isCutaway === enabled) return;
    isCutaway = enabled;
    for (const material of terrainMaterials) {
      material.clippingPlanes = enabled ? [cutPlane] : null;
      material.needsUpdate = true;
    }
    if (!enabled) {
      for (const panel of station.removablePanels) panel.visible = true;
    }
  }

  function cutaway() {
    localCamera.copy(camera.position);
    station.spin.worldToLocal(localCamera);
    const azimuth = Math.atan2(localCamera.x, -localCamera.y);
    station.removablePanels.forEach((panel, index) => {
      const sector = ((index + 0.5) * TAU) / 12;
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
          duration: route === "orbital" ? 1.35 : 2.65,
          route,
        };
    view = next;
    keys.clear();
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
      destination === "system" ? 0.74 : 0.39,
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
    if (transition.route !== "orbital") {
      const descent =
        transition.route === "landing" || transition.route === "takeoff";
      const inbound =
        transition.route === "inbound" || transition.route === "landing";
      if (descent) {
        approach.copy(cityPoint(CITY_LANDING.x, CITY_LANDING.z + 0.23, 0.31));
        doorway.copy(cityPoint(CITY_LANDING.x, CITY_LANDING.z + 0.048, 0.014));
        station.spin.localToWorld(approach);
        station.spin.localToWorld(doorway);
      } else {
        approach.set(0.08, 0.16, HALF_LENGTH + 7.3);
        doorway.set(-0.12, 0.08, HALF_LENGTH - 1.7);
        station.root.localToWorld(approach);
        station.root.localToWorld(doorway);
      }
      const s = 1 - eased;
      camera.position
        .copy(transition.from.position)
        .multiplyScalar(s ** 3)
        .addScaledVector(inbound ? approach : doorway, 3 * s * s * eased)
        .addScaledVector(inbound ? doorway : approach, 3 * s * eased * eased)
        .addScaledVector(desired.position, eased ** 3);
    } else {
      camera.position.lerpVectors(
        transition.from.position,
        desired.position,
        eased,
      );
    }
    camera.quaternion.slerpQuaternions(
      transition.from.rotation,
      desired.rotation,
      eased,
    );
    if (t === 1) transition = null;
  }

  function interpolate(value: number, target: number, delta: number) {
    if (Math.abs(value - target) < 0.0001 || motionPreference.matches)
      return target;
    return damp(value, target, 13, delta);
  }

  function frame(now: number) {
    const delta = Math.min((now - last) / 1000, 0.06);
    last = now;
    if (!available || document.hidden) return;
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
    )
      return;
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
    station.root.updateMatrixWorld(true);
    atlas.update(elapsed);
    applyCamera(delta);
    if (isCutaway) cutaway();
    const inside =
      isHabitatView(view) &&
      (transition?.route !== "inbound" ||
        transition.elapsed > transition.duration * 0.57);
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
    scene.fog = inside ? atmosphere : null;
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
          : THREE.MathUtils.lerp(0.31, 0.065, sunApproach),
    );
    stars.mesh.position.copy(camera.position);
    stars.mesh.visible = !inside;
    atlas.faceCamera(camera, elapsed);
    renderer.render(scene, camera);
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
    available = true;
    dirty = true;
    onGraphics(true);
  });
  host.append(renderer.domElement);
  new ResizeObserver(fit).observe(host);
  fit();
  setDestination(initialDestination);
  setView(initialView);
  transition = null;
  orbit = { ...orbitTarget };
  camera.fov = viewFov(initialView);
  camera.updateProjectionMatrix();
  frame(performance.now());
  renderer.setAnimationLoop(frame);
  onGraphics(true);

  return {
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
