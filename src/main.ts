import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./style.css";
import arrow from "@tabler/icons/outline/arrow-up-right.svg?raw";
import back from "@tabler/icons/outline/arrow-left.svg?raw";
import close from "@tabler/icons/outline/x.svg?raw";
import cutaway from "@tabler/icons/outline/box-model-2.svg?raw";
import down from "@tabler/icons/outline/chevron-down.svg?raw";
import habitat from "@tabler/icons/outline/trees.svg?raw";
import info from "@tabler/icons/outline/info-circle.svg?raw";
import left from "@tabler/icons/outline/chevron-left.svg?raw";
import orbit from "@tabler/icons/outline/orbit.svg?raw";
import pause from "@tabler/icons/outline/player-pause.svg?raw";
import play from "@tabler/icons/outline/player-play.svg?raw";
import reset from "@tabler/icons/outline/focus-2.svg?raw";
import right from "@tabler/icons/outline/chevron-right.svg?raw";
import up from "@tabler/icons/outline/chevron-up.svg?raw";
import { DEFAULT_RPM, rimGravity } from "./physics";
import type { View, startFlight } from "./flight";

const icons = {
  arrow,
  back,
  close,
  cutaway,
  down,
  habitat,
  info,
  left,
  orbit,
  pause,
  play,
  reset,
  right,
  up,
};
for (const node of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const name = node.dataset.icon;
  const svg = Object.entries(icons).find(([key]) => key === name)?.[1];
  if (svg) node.innerHTML = svg;
  node.setAttribute("aria-hidden", "true");
}

function get<T extends HTMLElement>(id: string, elementType: { new (): T }): T;
function get(id: string): HTMLElement;
function get(id: string, elementType = HTMLElement) {
  const node = document.getElementById(id);
  if (!(node instanceof elementType)) throw new Error(`Missing flight deck element: ${id}`);
  return node;
}

const stage = get("stage");
const world = get("world");
const brief = get("brief", HTMLDialogElement);
const enter = get("enter", HTMLButtonElement);
const resetButton = get("reset-view", HTMLButtonElement);
const spin = get("spin", HTMLInputElement);
const spinValue = get("spin-value", HTMLOutputElement);
const toggle = get("toggle-spin", HTMLButtonElement);
const timeButton = get("time-scale", HTMLButtonElement);
const gravity = get("gravity", HTMLOutputElement);
const system = get("system-state");
const graphicsNotice = get("graphics-notice");
const timeScales = [1, 5, 15];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const views: Record<View, { id: string; tip: string }> = {
  orbital: { id: "CAM 01 / ORBITAL", tip: "Drag to orbit · Scroll or pinch to zoom" },
  cutaway: { id: "CAM 02 / CUTAWAY", tip: "Drag to inspect · Scroll or pinch to zoom" },
  habitat: { id: "CAM 03 / HABITAT", tip: "WASD or buttons to move · Drag to look" },
};
const viewButtons = document.querySelectorAll<HTMLButtonElement>(".view-switch button");
let timeIndex = 0;
let running = !reducedMotion.matches;
let hasGraphics = false;
let loaded = false;
let flight: ReturnType<typeof startFlight> | undefined;

function spinChanged() {
  const rpm = spin.valueAsNumber;
  const label = running ? "Pause simulation" : "Resume simulation";
  spinValue.innerHTML = `${rpm.toFixed(2)} <span>RPM</span>`;
  gravity.value = rimGravity(rpm).toFixed(2);
  toggle.innerHTML = running ? pause : play;
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
  const time = timeScales[timeIndex];
  timeButton.textContent = `${time}×`;
  timeButton.setAttribute("aria-label", `Time scale ${time} times. Change time scale.`);
  system.textContent = hasGraphics
    ? running && rpm
      ? "Simulation Live"
      : "Simulation Paused"
    : loaded
      ? "Gravity Model"
      : "Initializing";
  const lamp = system.closest<HTMLElement>(".live-label");
  if (lamp) lamp.dataset.paused = String(!hasGraphics || !running || rpm === 0);
  flight?.setSpin(rpm, time, running);
}

function switchView(view: View, focusWorld = true) {
  if (!hasGraphics) return;
  stage.dataset.view = view;
  get("view-id").textContent = views[view].id;
  get("view-tip").textContent = views[view].tip;
  for (const button of viewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  flight?.setView(view);
  if (focusWorld) world.focus({ preventScroll: true });
}

function graphicsChanged(available: boolean) {
  hasGraphics = available;
  loaded = true;
  stage.dataset.ready = String(available);
  enter.disabled = !available;
  resetButton.disabled = !available;
  graphicsNotice.hidden = available;
  for (const button of viewButtons) button.disabled = !available;
  if (!available) {
    stage.dataset.view = "orbital";
    get("view-id").textContent = "STATION PREVIEW";
    get("view-tip").textContent = "";
  } else {
    switchView("orbital", false);
  }
  spinChanged();
}

enter.addEventListener("click", () => switchView("habitat"));
get("exit").addEventListener("click", () => switchView("orbital"));
resetButton.addEventListener("click", () => flight?.reset());
get("open-brief").addEventListener("click", () => brief.showModal());
brief.addEventListener("click", (event) => {
  if (event.target === brief) brief.close();
});

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "orbital" || view === "cutaway" || view === "habitat") switchView(view);
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-move]")) {
  const key = button.dataset.move;
  if (!key) continue;
  let pressedAt = 0;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pressedAt = performance.now();
    button.setPointerCapture(event.pointerId);
    flight?.move(key, true);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    button.addEventListener(name, () => flight?.move(key, false));
  }
  button.addEventListener("click", (event) => {
    if (event.detail === 0 || performance.now() - pressedAt < 150) flight?.nudge(key);
  });
}

spin.value = String(DEFAULT_RPM);
spin.addEventListener("input", spinChanged);
toggle.addEventListener("click", () => {
  running = !running;
  spinChanged();
});
timeButton.addEventListener("click", () => {
  timeIndex = (timeIndex + 1) % timeScales.length;
  spinChanged();
});
reducedMotion.addEventListener("change", (event) => {
  running = !event.matches;
  spinChanged();
});
spinChanged();

requestAnimationFrame(() => {
  void import("./flight")
    .then(({ startFlight }) => {
      flight = startFlight({
        host: world,
        onGraphics: graphicsChanged,
        allowControls: () => !brief.open,
      });
      spinChanged();
    })
    .catch(() => graphicsChanged(false));
});
