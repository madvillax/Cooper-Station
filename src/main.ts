import arrow from "@tabler/icons/outline/arrow-up-right.svg?raw";
import back from "@tabler/icons/outline/arrow-left.svg?raw";
import close from "@tabler/icons/outline/x.svg?raw";
import cutaway from "@tabler/icons/outline/box-model-2.svg?raw";
import down from "@tabler/icons/outline/chevron-down.svg?raw";
import home from "@tabler/icons/outline/home.svg?raw";
import left from "@tabler/icons/outline/chevron-left.svg?raw";
import list from "@tabler/icons/outline/list-details.svg?raw";
import minus from "@tabler/icons/outline/minus.svg?raw";
import orbit from "@tabler/icons/outline/orbit.svg?raw";
import pause from "@tabler/icons/outline/player-pause.svg?raw";
import play from "@tabler/icons/outline/player-play.svg?raw";
import plus from "@tabler/icons/outline/plus.svg?raw";
import reset from "@tabler/icons/outline/focus-2.svg?raw";
import right from "@tabler/icons/outline/chevron-right.svg?raw";
import spinIcon from "@tabler/icons/outline/rotate-clockwise.svg?raw";
import up from "@tabler/icons/outline/chevron-up.svg?raw";
import {
  destinationGroups,
  destinationInfo,
  locationFromHash,
  type Destination,
  type View,
} from "./destinations";
import { DEFAULT_RPM, rimGravity } from "./physics";
import type { startFlight } from "./flight";
import { createLaunchStarfield } from "./launch-stars";
import "./style.css";

const icons = {
  arrow,
  back,
  close,
  cutaway,
  down,
  home,
  left,
  list,
  minus,
  orbit,
  pause,
  plus,
  reset,
  right,
  spin: spinIcon,
  up,
};
for (const node of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const svg = Object.entries(icons).find(
    ([key]) => key === node.dataset.icon,
  )?.[1];
  if (svg) node.innerHTML = svg;
  node.setAttribute("aria-hidden", "true");
}

function get<T extends HTMLElement>(id: string, elementType: { new (): T }): T;
function get(id: string): HTMLElement;
function get(id: string, elementType = HTMLElement) {
  const node = document.getElementById(id);
  if (!(node instanceof elementType))
    throw new Error(`Missing viewer element: ${id}`);
  return node;
}

const launch = get("launch");
const launchCanvas = get("launch-stars", HTMLCanvasElement);
const enterSpace = get("enter-space", HTMLButtonElement);
const explorer = get("explorer");
const world = get("world");
const dialog = get("destinations", HTMLDialogElement);
const stationActions = get("station-actions");
const movePad = get("move-pad");
const enterHabitat = get("enter-habitat", HTMLButtonElement);
const landCity = get("land-city", HTMLButtonElement);
const takeOff = get("take-off", HTMLButtonElement);
const zoomControls = get("zoom-controls");
const exitHabitat = get("exit-habitat", HTMLButtonElement);
const cutawayButton = get("cutaway", HTMLButtonElement);
const visitStation = get("visit-station", HTMLButtonElement);
const spinPanel = get("spin-panel");
const spinToggle = get("open-spin", HTMLButtonElement);
const spin = get("spin", HTMLInputElement);
const spinValue = get("spin-value", HTMLOutputElement);
const gravity = get("gravity", HTMLOutputElement);
const pauseButton = get("toggle-spin", HTMLButtonElement);
const timeButton = get("time-scale", HTMLButtonElement);
const timeScales = [1, 5, 15];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const destinationButtons = new Map<Destination, HTMLButtonElement>();
const resumeLocation = locationFromHash(location.hash);
let destination: Destination = resumeLocation?.destination ?? "station";
let stationView: View = resumeLocation?.view ?? "orbital";
let playing = !reducedMotion.matches;
let timeIndex = 0;
let flight: ReturnType<typeof startFlight> | undefined;
let launchStars: ReturnType<typeof createLaunchStarfield>;

function labelButton(id: Destination) {
  const info = destinationInfo(id);
  const button = document.createElement("button");
  button.type = "button";
  button.style.setProperty(
    "--body-color",
    `#${info.color.toString(16).padStart(6, "0")}`,
  );
  const dot = document.createElement("span");
  dot.className = "body-dot";
  dot.setAttribute("aria-hidden", "true");
  button.append(dot, info.name);
  button.addEventListener("click", () => selectDestination(id));
  return button;
}

for (const { label, ids } of destinationGroups) {
  const section = document.createElement("section");
  section.className = "destination-group";
  const heading = document.createElement("h3");
  heading.textContent = label;
  const entries = document.createElement("div");
  entries.className = "destination-entries";
  for (const id of ids) {
    const button = labelButton(id);
    button.className = "destination-button";
    destinationButtons.set(id, button);
    entries.append(button);
  }
  section.append(heading, entries);
  get("destination-list").append(section);
}

function setSpinPanel(open: boolean) {
  spinPanel.hidden = !open;
  spinToggle.setAttribute("aria-expanded", String(open));
}

function saveLocation() {
  const mode =
    destination === "station" && stationView !== "orbital"
      ? `/${stationView}`
      : "";
  const hash = `#${destination}${mode}`;
  if (location.hash !== hash) history.replaceState(history.state, "", hash);
}

function showLocation() {
  const info = destinationInfo(destination);
  const inStation = destination === "station";
  const grounded = inStation && stationView === "ground";
  const inside = grounded || (inStation && stationView === "habitat");
  explorer.dataset.destination = destination;
  explorer.dataset.view = stationView;
  get("location-name").textContent = grounded
    ? "Cooper City"
    : inside
      ? "Habitat Flyover"
      : info.name;
  world.setAttribute(
    "aria-label",
    grounded
      ? "Street-level view of Cooper City. Walk with W A S D or the on-screen arrows. Drag to look."
      : inside
        ? "Aerial view of Cooper Station. Fly with W A S D or the on-screen arrows. Drag to look."
        : "3D space view. Drag or use the arrow keys to orbit. Scroll to travel in the Solar System. Use plus and minus to zoom.",
  );
  stationActions.hidden = !inStation;
  visitStation.hidden = destination !== "saturn";
  enterHabitat.hidden = inside;
  landCity.hidden = !inside || grounded;
  takeOff.hidden = !grounded;
  zoomControls.hidden = inside;
  cutawayButton.hidden = inside;
  cutawayButton.setAttribute("aria-pressed", String(stationView === "cutaway"));
  exitHabitat.hidden = !inside || grounded;
  movePad.hidden = !inside;
  for (const [id, button] of destinationButtons) {
    button.setAttribute("aria-pressed", String(id === destination));
  }
}

function selectDestination(next: Destination) {
  if (dialog.open) dialog.close();
  flight?.setDestination(next);
  if (destination !== next) {
    destination = next;
    stationView = "orbital";
    setSpinPanel(false);
    showLocation();
    saveLocation();
  }
  world.focus({ preventScroll: true });
}

function selectStationView(next: View) {
  stationView = next;
  flight?.setView(next);
  setSpinPanel(false);
  showLocation();
  saveLocation();
  world.focus({ preventScroll: true });
}

function syncSpin() {
  const rpm = spin.valueAsNumber;
  const timeScale = timeScales[timeIndex];
  spinValue.value = `${rpm.toFixed(2)} RPM`;
  gravity.value = rimGravity(rpm).toFixed(2);
  pauseButton.innerHTML = playing ? pause : play;
  const label = playing ? "Pause rotation" : "Resume rotation";
  pauseButton.setAttribute("aria-label", label);
  pauseButton.title = label;
  timeButton.textContent = `${timeScale}×`;
  timeButton.setAttribute(
    "aria-label",
    `Time scale ${timeScale} times. Change time scale.`,
  );
  flight?.setSpin(rpm, timeScale, playing);
}

function syncLaunchMotion() {
  const visible = !launch.hidden && !launch.inert && !document.hidden;
  if (visible) launchStars ??= createLaunchStarfield(launchCanvas);
  launchStars?.setActive(visible, !reducedMotion.matches);
}

function graphicsChanged(ready: boolean) {
  explorer.hidden = !ready;
  launch.inert = ready;
  if (!ready) launch.hidden = false;
  syncLaunchMotion();
  get("graphics-message").hidden = ready;
  enterSpace.disabled = false;
  get("enter-label").textContent = "Enter Space";
  if (ready) {
    saveLocation();
    world.focus({ preventScroll: true });
    if (launch.hidden) return;
    if (reducedMotion.matches) launch.hidden = true;
    else {
      const fade = launch.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 430,
        easing: "ease-out",
      });
      void fade.finished.then(() => {
        launch.hidden = !explorer.hidden;
      });
    }
  } else if (dialog.open) dialog.close();
}

function startExplorer(resuming = false) {
  if (flight || enterSpace.disabled) return;
  enterSpace.disabled = true;
  get("graphics-message").hidden = true;
  get("enter-label").textContent = "Entering Space…";
  explorer.hidden = false;
  if (resuming) launch.hidden = true;
  void import("./flight")
    .then(({ startFlight }) => {
      flight = startFlight({
        host: world,
        initialDestination: destination,
        initialView: stationView,
        onGraphics: graphicsChanged,
        allowControls: () => !dialog.open,
        onSelectBody: selectDestination,
        onRouteStop: (next) => {
          destination = next;
          showLocation();
          saveLocation();
        },
      });
      syncSpin();
    })
    .catch((error: unknown) => {
      console.error("Unable to start the 3D viewer", error);
      graphicsChanged(false);
    });
}

enterSpace.addEventListener("click", () => startExplorer());
window.addEventListener("hashchange", () => location.reload());

get("return-map").addEventListener("click", () => selectDestination("system"));
get("reset-view").addEventListener("click", () => flight?.reset());
get("zoom-in").addEventListener("click", () => flight?.zoom(0.8));
get("zoom-out").addEventListener("click", () => flight?.zoom(1.25));
get("open-destinations").addEventListener("click", () => dialog.showModal());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
visitStation.addEventListener("click", () => selectDestination("station"));
enterHabitat.addEventListener("click", () => selectStationView("habitat"));
landCity.addEventListener("click", () => selectStationView("ground"));
takeOff.addEventListener("click", () => selectStationView("habitat"));
exitHabitat.addEventListener("click", () => selectStationView("orbital"));
cutawayButton.addEventListener("click", () =>
  selectStationView(stationView === "cutaway" ? "orbital" : "cutaway"),
);
spinToggle.addEventListener("click", () => setSpinPanel(spinPanel.hidden));
spin.value = String(DEFAULT_RPM);
spin.addEventListener("input", syncSpin);
pauseButton.addEventListener("click", () => {
  playing = !playing;
  syncSpin();
});
timeButton.addEventListener("click", () => {
  timeIndex = (timeIndex + 1) % timeScales.length;
  syncSpin();
});
reducedMotion.addEventListener("change", (event) => {
  playing = !event.matches;
  syncSpin();
  syncLaunchMotion();
});
document.addEventListener("visibilitychange", syncLaunchMotion);

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-move]",
)) {
  const key = button.dataset.move;
  if (!key) continue;
  let pressedAt = 0;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pressedAt = performance.now();
    button.setPointerCapture(event.pointerId);
    flight?.move(key, true);
  });
  for (const name of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const) {
    button.addEventListener(name, () => flight?.move(key, false));
  }
  button.addEventListener("click", (event) => {
    if (event.detail === 0 || performance.now() - pressedAt < 150)
      flight?.nudge(key);
  });
}

showLocation();
syncSpin();
if (resumeLocation) startExplorer(true);
else syncLaunchMotion();
