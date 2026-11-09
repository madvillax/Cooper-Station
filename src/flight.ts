import * as THREE from "three";
import { createSpace } from "./environment";
import { DEFAULT_RPM, radiansPerSecond } from "./physics";
import { createStation, HALF_LENGTH, RADIUS, TAU, terrainPoint } from "./station";

export const VIEWS = ["orbital", "cutaway", "habitat"] as const;
export type View = (typeof VIEWS)[number];
type Orbit = { yaw: number; pitch: number; zoom: number };
type Walk = { u: number; v: number; yaw: number; pitch: number };
type Pose = { position: THREE.Vector3; rotation: THREE.Quaternion };
type Transition = {
  from: Pose;
  elapsed: number;
  duration: number;
  route: "inbound" | "outbound" | "orbital";
};

const defaultOrbit: Record<Exclude<View, "habitat">, Orbit> = {
  orbital: { yaw: -0.12, pitch: 0.11, zoom: 1 },
  cutaway: { yaw: 0.32, pitch: 0.39, zoom: 1 },
};
const startWalk: Walk = { u: 0.486, v: 0.91, yaw: 0.19, pitch: 0.11 };
const worldUp = new THREE.Vector3(0, 1, 0);
const cameraMatrix = new THREE.Matrix4();
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;

function pose() {
  return { position: new THREE.Vector3(), rotation: new THREE.Quaternion() };
}

export function startFlight({
  host,
  onGraphics,
  allowControls,
}: {
  host: HTMLElement;
  onGraphics: (available: boolean) => void;
  allowControls: () => boolean;
}) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x06090f);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.localClippingEnabled = true;
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  const atmosphere = new THREE.FogExp2(0x758b92, 0.034);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.012, 260);
  const station = createStation();
  const cutPlane = new THREE.Plane();
  const terrainMaterials = new Set<THREE.Material>();
  station.landscape.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) {
      terrainMaterials.add(object.material);
    }
  });
  scene.add(createSpace(), station.root, new THREE.HemisphereLight(0xe1edff, 0x4a535a, 1.16));

  const sun = new THREE.DirectionalLight(0xffdfb8, 2.78);
  sun.position.set(-5, 8, 9);
  const bounce = new THREE.DirectionalLight(0xa7bbd2, 0.8);
  bounce.position.set(5, -2, -8);
  const interior = new THREE.PointLight(0xffe6bf, 21, 17, 1.5);
  interior.position.set(0, 0, 1.4);
  station.root.add(interior);
  scene.add(sun, bounce);

  const desired = pose();
  const focus = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  const approach = new THREE.Vector3();
  const doorway = new THREE.Vector3();
  const localCamera = new THREE.Vector3();
  const cutNormal = new THREE.Vector3();
  const rootRotation = new THREE.Quaternion();
  const pointers = new Map<number, { x: number; y: number }>();
  const keys = new Set<string>();
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let orbit = { ...defaultOrbit.orbital };
  let orbitTarget = { ...orbit };
  let walk = { ...startWalk };
  let look = { yaw: startWalk.yaw, pitch: startWalk.pitch };
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

  function targetPose() {
    if (view === "habitat") {
      desired.position.copy(terrainPoint(walk.u, walk.v, 0.067));
      const a = walk.u * TAU - Math.PI * 1.5;
      up.set(-Math.cos(a), -Math.sin(a), 0);
      side.set(-Math.sin(a), Math.cos(a), 0);
      forward.set(0, 0, -Math.cos(walk.yaw)).addScaledVector(side, Math.sin(walk.yaw));
      forward.multiplyScalar(Math.cos(walk.pitch)).addScaledVector(up, Math.sin(walk.pitch));
      focus.copy(desired.position).add(forward);
      cameraMatrix.lookAt(desired.position, focus, up);
      desired.rotation.setFromRotationMatrix(cameraMatrix);
      station.spin.getWorldQuaternion(rootRotation);
      desired.rotation.premultiply(rootRotation);
      station.spin.localToWorld(desired.position);
    } else {
      const compact = viewportWidth < 620;
      const distance =
        orbit.zoom * (compact ? 22 * Math.max(1, viewportHeight / viewportWidth / 1.25) : 18.6);
      desired.position.set(
        Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * distance,
        Math.sin(orbit.pitch) * distance,
        Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * distance,
      );
      focus.set(compact ? -0.18 : -3.65, compact ? -2.4 : -0.15, 0);
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
    const density = Math.sqrt(2_400_000 / (viewportWidth * viewportHeight));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7, Math.max(1, density)));
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
    if (view === next) return;
    const route = next === "habitat" ? "inbound" : view === "habitat" ? "outbound" : "orbital";
    transition = motionPreference.matches
      ? null
      : {
          from: { position: camera.position.clone(), rotation: camera.quaternion.clone() },
          elapsed: 0,
          duration: route === "orbital" ? 1.35 : 2.65,
          route,
        };
    view = next;
    keys.clear();
    if (next === "habitat") {
      walk = { ...startWalk };
      look = { yaw: walk.yaw, pitch: walk.pitch };
    } else {
      orbit = { ...defaultOrbit[next] };
      orbitTarget = { ...orbit };
    }
    setCutaway(next === "cutaway");
    dirty = true;
  }

  function reset() {
    if (view === "habitat") {
      walk = { ...startWalk };
      look = { yaw: walk.yaw, pitch: walk.pitch };
      transition = null;
    } else {
      orbitTarget = { ...defaultOrbit[view] };
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
    if (view === "habitat") {
      look.yaw -= x;
      look.pitch = clamp(look.pitch + y, -1.26, 1.38);
    } else {
      orbitTarget.yaw -= x;
      orbitTarget.pitch = clamp(orbitTarget.pitch + y, -1.23, 1.23);
    }
    dirty = true;
  }

  function zoom(factor: number) {
    if (view === "habitat") return;
    orbitTarget.zoom = clamp(orbitTarget.zoom * factor, 0.65, 2.1);
    dirty = true;
  }

  function moveAcross(forward: number, lateral: number, seconds: number) {
    const speed = (0.78 * seconds) / Math.max(1, Math.hypot(forward, lateral));
    walk.v = clamp(
      walk.v -
        ((Math.cos(walk.yaw) * forward - Math.sin(walk.yaw) * lateral) * speed) / (HALF_LENGTH * 2),
      0.04,
      0.96,
    );
    walk.u = THREE.MathUtils.euclideanModulo(
      walk.u +
        ((Math.sin(walk.yaw) * forward + Math.cos(walk.yaw) * lateral) * speed) / (RADIUS * TAU),
      1,
    );
  }

  function stepControls(delta: number) {
    const key = (code: string) => Number(keys.has(code));
    aim(
      (key("ArrowLeft") - key("ArrowRight")) * delta * 1.4,
      (key("ArrowUp") - key("ArrowDown")) * delta * 1.4,
    );
    if (view === "habitat") {
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
      approach.set(0.08, 0.16, HALF_LENGTH + 7.3);
      doorway.set(-0.12, 0.08, HALF_LENGTH - 1.7);
      station.root.localToWorld(approach);
      station.root.localToWorld(doorway);
      const inbound = transition.route === "inbound";
      const s = 1 - eased;
      camera.position
        .copy(transition.from.position)
        .multiplyScalar(s ** 3)
        .addScaledVector(inbound ? approach : doorway, 3 * s * s * eased)
        .addScaledVector(inbound ? doorway : approach, 3 * s * eased * eased)
        .addScaledVector(desired.position, eased ** 3);
    } else {
      camera.position.lerpVectors(transition.from.position, desired.position, eased);
    }
    camera.quaternion.slerpQuaternions(transition.from.rotation, desired.rotation, eased);
    if (t === 1) transition = null;
  }

  function interpolate(value: number, target: number, delta: number) {
    if (Math.abs(value - target) < 0.0001 || motionPreference.matches) return target;
    return damp(value, target, 13, delta);
  }

  function frame(now: number) {
    const delta = Math.min((now - last) / 1000, 0.06);
    last = now;
    if (!available || document.hidden) return;
    const spinning = playing && rpm > 0;
    const moving =
      view === "habitat"
        ? walk.yaw !== look.yaw || walk.pitch !== look.pitch
        : orbit.yaw !== orbitTarget.yaw ||
          orbit.pitch !== orbitTarget.pitch ||
          orbit.zoom !== orbitTarget.zoom;
    if (!dirty && !spinning && !moving && !transition && !keys.size) return;
    if (keys.size && !transition && allowControls()) stepControls(delta);
    orbit.yaw = interpolate(orbit.yaw, orbitTarget.yaw, delta);
    orbit.pitch = interpolate(orbit.pitch, orbitTarget.pitch, delta);
    orbit.zoom = interpolate(orbit.zoom, orbitTarget.zoom, delta);
    walk.yaw = interpolate(walk.yaw, look.yaw, delta);
    walk.pitch = interpolate(walk.pitch, look.pitch, delta);
    if (spinning) {
      station.spin.rotation.z =
        (station.spin.rotation.z + radiansPerSecond(rpm) * delta * timeScale) % TAU;
    }
    station.root.updateMatrixWorld(true);
    applyCamera(delta);
    if (isCutaway) cutaway();
    const inside =
      view === "habitat" && (!transition || transition.elapsed > transition.duration * 0.57);
    scene.fog = inside ? atmosphere : null;
    renderer.render(scene, camera);
    dirty = false;
  }

  const orbitKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  const walkKeys = ["KeyW", "KeyA", "KeyS", "KeyD"];
  window.addEventListener("keydown", (event) => {
    if (!allowControls() || !(event.target instanceof HTMLElement)) return;
    if (event.target.closest("button, input, dialog") && !walkKeys.includes(event.code)) return;
    if (orbitKeys.includes(event.code) || (view === "habitat" && walkKeys.includes(event.code))) {
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
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  host.addEventListener("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    if (pointers.size === 1) {
      aim((next.x - previous.x) * 0.005, (next.y - previous.y) * 0.005);
    } else {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const newDistance = Math.hypot(next.x - other.x, next.y - other.y);
        zoom(Math.max(10, oldDistance) / Math.max(10, newDistance));
      }
    }
    pointers.set(event.pointerId, next);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    host.addEventListener(name, (event) => pointers.delete(event.pointerId));
  }
  host.addEventListener(
    "wheel",
    (event) => {
      if (view === "habitat") return;
      event.preventDefault();
      zoom(Math.exp(clamp(event.deltaY, -140, 140) * 0.0015));
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
  frame(performance.now());
  renderer.setAnimationLoop(frame);
  onGraphics(true);

  return {
    setView,
    reset,
    move,
    nudge(key: string) {
      if (view !== "habitat" || transition) return;
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
