import "@fontsource/b612/400.css";
import "@fontsource/b612/700.css";
import "@fontsource/b612-mono/400.css";
import arrow from "@tabler/icons/outline/arrow-up-right.svg?raw";
import close from "@tabler/icons/outline/x.svg?raw";
import down from "@tabler/icons/outline/chevron-down.svg?raw";
import help from "@tabler/icons/outline/keyboard.svg?raw";
import list from "@tabler/icons/outline/list-details.svg?raw";
import minus from "@tabler/icons/outline/minus.svg?raw";
import orbit from "@tabler/icons/outline/orbit.svg?raw";
import pause from "@tabler/icons/outline/player-pause.svg?raw";
import play from "@tabler/icons/outline/player-play.svg?raw";
import plus from "@tabler/icons/outline/plus.svg?raw";
import reset from "@tabler/icons/outline/focus-2.svg?raw";
import settingsIcon from "@tabler/icons/outline/adjustments-horizontal.svg?raw";
import soundOff from "@tabler/icons/outline/volume-off.svg?raw";
import soundOn from "@tabler/icons/outline/volume.svg?raw";
import { DEFAULT_SOLAR_RATE, facts, timeRates } from "./bodies-data";
import {
  destinationGroups,
  destinationInfo,
  isSolarDestination,
  locationFromHash,
  type Destination,
  type View,
} from "./destinations";
import type { startFlight, Telemetry } from "./flight";
import { formatDate, formatDilation, formatRate } from "./format";
import {
  createHints,
  createLabels,
  createRail,
  createStick,
  renderFacts,
  type FactRow,
} from "./hud";
import { createLaunchStarfield } from "./launch-stars";
import { DEFAULT_RPM, rimGravity, rimSpeed, timeDilation } from "./physics";
import { loadSettings, saveSettings } from "./settings";
import "./style.css";

const icons: Record<string, string> = {
  arrow,
  close,
  down,
  help,
  list,
  minus,
  orbit,
  pause,
  plus,
  reset,
  settings: settingsIcon,
  sound: soundOn,
};
for (const node of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const svg = icons[node.dataset.icon ?? ""];
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
const atlas = get("destinations", HTMLDialogElement);
const helpSheet = get("help", HTMLDialogElement);
const settingsSheet = get("settings", HTMLDialogElement);
const sheets = [atlas, helpSheet, settingsSheet];
const stationActions = get("station-actions");
const enterHabitat = get("enter-habitat", HTMLButtonElement);
const landCity = get("land-city", HTMLButtonElement);
const takeOff = get("take-off", HTMLButtonElement);
const exitHabitat = get("exit-habitat", HTMLButtonElement);
const cutawayButton = get("cutaway", HTMLButtonElement);
const visitStation = get("visit-station", HTMLButtonElement);
const spinPanel = get("spin-panel");
const spinToggle = get("open-spin", HTMLButtonElement);
const spin = get("spin", HTMLInputElement);
const timeToggle = get("toggle-time", HTMLButtonElement);
const rateButton = get("time-rate", HTMLButtonElement);
const dateOutput = get("sim-date", HTMLOutputElement);
const soundToggle = get("toggle-sound", HTMLButtonElement);
const factsToggle = get("toggle-facts", HTMLButtonElement);
const factList = get("facts");
const railNav = get("rail");
const stickPad = get("stick");

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const destinationButtons = new Map<Destination, HTMLButtonElement>();
const resumeLocation = locationFromHash(location.hash);
const settings = loadSettings();
let destination: Destination = resumeLocation?.destination ?? "station";
let stationView: View = resumeLocation?.view ?? "orbital";
let playing = !reducedMotion.matches;
let stationRate = 0;
let solarRate = DEFAULT_SOLAR_RATE;
let flight: Awaited<ReturnType<typeof startFlight>> | undefined;
let launchStars: ReturnType<typeof createLaunchStarfield>;
let cameraRadiusInRs = 25;
let lastReadout = 0;

const hints = createHints(get("hint"));
const labels = createLabels(get("labels"), selectDestination);
const rail = createRail(railNav, orbit, selectDestination);
createStick(stickPad, get("stick-knob"), (x, y) => flight?.setMoveVector(x, y));

for (const { label, ids } of destinationGroups) {
  const section = document.createElement("section");
  section.className = "destination-group";
  const heading = document.createElement("h3");
  heading.textContent = label;
  section.append(heading);
  for (const id of ids) {
    const info = destinationInfo(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "destination-button";
    button.dataset.destination = id;
    button.dataset.name = info.name;
    button.style.setProperty(
      "--body-color",
      `#${info.color.toString(16).padStart(6, "0")}`,
    );
    const dot = document.createElement("span");
    dot.className = "body-dot";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = info.name;
    const summary = document.createElement("small");
    summary.textContent = facts(id).summary;
    button.append(dot, name, summary);
    button.addEventListener("click", () => selectDestination(id));
    destinationButtons.set(id, button);
    section.append(button);
  }
  get("destination-list").append(section);
}

function inside() {
  return (
    destination === "station" &&
    (stationView === "habitat" || stationView === "ground")
  );
}

/** Which clock a place runs on: the station's spin, the planets', or neither. */
function clockContext() {
  if (destination === "station") return "station";
  return isSolarDestination(destination) ? "solar" : "none";
}

function saveLocation() {
  const mode =
    destination === "station" && stationView !== "orbital"
      ? `/${stationView}`
      : "";
  const hash = `#${destination}${mode}`;
  if (location.hash !== hash) history.replaceState(history.state, "", hash);
}

function place() {
  if (destination === "station" && stationView === "ground") {
    return {
      name: "Cooper City",
      summary: "Street level, on the inside of the cylinder",
    };
  }
  if (inside()) {
    return {
      name: "Habitat flyover",
      summary: "Inside the cylinder, where the land curves overhead",
    };
  }
  return {
    name: destinationInfo(destination).name,
    summary: facts(destination).summary,
  };
}

/** Rows that change as you move or adjust something, shown in amber. */
function liveRows(): FactRow[] {
  if (destination === "station") {
    const rpm = spin.valueAsNumber;
    return [
      { label: "Spin", value: `${rpm.toFixed(2)} rpm`, live: true },
      { label: "Floor gravity", value: `${rimGravity(rpm).toFixed(2)} g`, live: true },
      { label: "Floor speed", value: `${Math.round(rimSpeed(rpm))} m/s`, live: true },
    ];
  }
  if (destination === "blackhole") {
    return [
      {
        label: "Distance",
        value: `${cameraRadiusInRs.toFixed(1)} radii`,
        live: true,
      },
      {
        label: "Time",
        value: formatDilation(timeDilation(cameraRadiusInRs)),
        live: true,
      },
    ];
  }
  return [];
}

function showFacts() {
  renderFacts(factList, [...liveRows(), ...facts(destination).rows]);
}

function showLocation() {
  const { name, summary } = place();
  const atStation = destination === "station";
  const grounded = atStation && stationView === "ground";
  const within = inside();
  explorer.dataset.destination = destination;
  explorer.dataset.view = stationView;
  get("location-name").textContent = name;
  get("location-summary").textContent = summary;
  showFacts();
  world.setAttribute(
    "aria-label",
    grounded
      ? "Street-level view of Cooper City. Walk with W A S D. Drag to look."
      : within
        ? "Aerial view inside Cooper Station. Fly with W A S D. Drag to look."
        : "3D space view. Drag to look around. Scroll to zoom.",
  );
  stationActions.hidden = !atStation;
  visitStation.hidden = destination !== "saturn";
  enterHabitat.hidden = within;
  landCity.hidden = !within || grounded;
  takeOff.hidden = !grounded;
  cutawayButton.hidden = within;
  cutawayButton.setAttribute("aria-pressed", String(stationView === "cutaway"));
  exitHabitat.hidden = !within || grounded;
  get("zoom-controls").hidden = within;
  stickPad.hidden = !within;
  railNav.hidden = !isSolarDestination(destination);
  rail.setCurrent(destination);
  for (const [id, button] of destinationButtons) {
    if (id === destination) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
  showClock();
}

function setSpinPanel(open: boolean) {
  spinPanel.hidden = !open;
  spinToggle.setAttribute("aria-expanded", String(open));
}

function selectDestination(next: Destination) {
  for (const sheet of sheets) if (sheet.open) sheet.close();
  flight?.setDestination(next);
  if (destination !== next) {
    if (destination === "system") hints.did("pick");
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

function showClock() {
  const context = clockContext();
  timeToggle.innerHTML = playing ? pause : play;
  const label = playing ? "Pause time" : "Resume time";
  timeToggle.setAttribute("aria-label", label);
  timeToggle.title = `${label} (Space)`;
  rateButton.hidden = context === "none";
  dateOutput.hidden = context !== "solar";
  if (context !== "none") {
    const rate =
      context === "station"
        ? timeRates.station[stationRate]
        : timeRates.solar[solarRate];
    rateButton.textContent = formatRate(rate);
    rateButton.setAttribute(
      "aria-label",
      `Speed: ${formatRate(rate)}. Change speed.`,
    );
  }
}

function syncClock() {
  showClock();
  flight?.setSpin(spin.valueAsNumber);
  flight?.setClock({
    playing,
    stationRate: timeRates.station[stationRate],
    solarRate: timeRates.solar[solarRate],
  });
}

function toggleTime() {
  playing = !playing;
  syncClock();
}

function setSound(on: boolean) {
  settings.sound = on;
  saveSettings(settings);
  soundToggle.setAttribute("aria-pressed", String(on));
  soundToggle.innerHTML = on ? soundOn : soundOff;
  soundToggle.title = on ? "Sound on" : "Sound off";
  get("setting-sound", HTMLInputElement).checked = on;
}

function setGuides(on: boolean) {
  settings.guides = on;
  saveSettings(settings);
  get("setting-guides", HTMLInputElement).checked = on;
  flight?.setGuides(on);
}

function setHudHidden(hidden: boolean) {
  explorer.classList.toggle("bare", hidden);
  get("show-hud").hidden = !hidden;
  if (hidden) for (const sheet of sheets) if (sheet.open) sheet.close();
  world.focus({ preventScroll: true });
}

function open(sheet: HTMLDialogElement) {
  for (const other of sheets) if (other !== sheet && other.open) other.close();
  if (!sheet.open) sheet.showModal();
}

/** Called after every drawn frame. Labels move every frame; text ten times a second. */
function onFrame(telemetry: Telemetry) {
  labels.update(telemetry.labels);
  const now = performance.now();
  if (now - lastReadout < 100) return;
  lastReadout = now;
  cameraRadiusInRs = telemetry.cameraRadiusInRs;
  const date = formatDate(telemetry.simDays);
  if (dateOutput.textContent !== date) dateOutput.textContent = date;
  if (destination === "blackhole") showFacts();
}

function syncLaunchMotion() {
  const visible = !launch.hidden && !launch.inert && !document.hidden;
  if (visible) launchStars ??= createLaunchStarfield(launchCanvas);
  launchStars?.setActive(visible, !reducedMotion.matches);
}

function graphicsChanged(ready: boolean) {
  explorer.hidden = !ready;
  explorer.inert = !ready;
  launch.inert = ready;
  if (!ready) launch.hidden = false;
  syncLaunchMotion();
  get("graphics-message").hidden = ready;
  enterSpace.disabled = false;
  get("enter-label").textContent = "Enter Space";
  if (ready) {
    saveLocation();
    world.focus({ preventScroll: true });
    hints.offer("look");
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
  } else {
    for (const sheet of sheets) if (sheet.open) sheet.close();
  }
}

function startExplorer() {
  if (flight || enterSpace.disabled) return;
  enterSpace.disabled = true;
  get("graphics-message").hidden = true;
  get("enter-label").textContent = "Entering Space…";
  // Laid out so the canvas can be sized, but not usable until the view exists:
  // a control used now would change the HUD and not the scene.
  explorer.hidden = false;
  explorer.inert = true;
  void import("./flight")
    .then(({ startFlight }) =>
      startFlight({
        host: world,
        initialDestination: destination,
        initialView: stationView,
        onGraphics: graphicsChanged,
        onProgress: (fraction, label) => {
          get("enter-label").textContent =
            `${label} ${Math.round(fraction * 100)}%`;
        },
        onFrame,
        onAction(action) {
          if (action === "toggle-time") toggleTime();
          else if (action === "toggle-hud") {
            setHudHidden(!explorer.classList.contains("bare"));
          } else if (action === "open-atlas") open(atlas);
          else open(helpSheet);
        },
        allowControls: () => !sheets.some((sheet) => sheet.open),
        onSelectBody: selectDestination,
        onRouteStop: (next) => {
          destination = next;
          showLocation();
          saveLocation();
        },
      }),
    )
    .then((started) => {
      flight = started;
      if (import.meta.env.DEV) Object.assign(window, { __flight: started });
      flight.setQuality(settings.quality);
      flight.setGuides(settings.guides);
      syncClock();
    })
    .catch((error: unknown) => {
      console.error("Unable to start the 3D viewer", error);
      graphicsChanged(false);
    });
}

enterSpace.addEventListener("click", () => startExplorer());
window.addEventListener("hashchange", () => location.reload());

get("reset-view").addEventListener("click", () => flight?.reset());
get("zoom-in").addEventListener("click", () => flight?.zoom(0.8));
get("zoom-out").addEventListener("click", () => flight?.zoom(1.25));
get("open-destinations").addEventListener("click", () => open(atlas));
get("open-help").addEventListener("click", () => open(helpSheet));
get("open-settings").addEventListener("click", () => open(settingsSheet));
get("show-hud").addEventListener("click", () => setHudHidden(false));
get("hide-hud").addEventListener("click", () => setHudHidden(true));
for (const sheet of sheets) {
  // A click on the dimmed area around a sheet closes it.
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.close();
  });
}
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
spin.addEventListener("input", () => {
  flight?.setSpin(spin.valueAsNumber);
  showFacts();
});
timeToggle.addEventListener("click", toggleTime);
rateButton.addEventListener("click", () => {
  if (clockContext() === "station") {
    stationRate = (stationRate + 1) % timeRates.station.length;
  } else {
    solarRate = (solarRate + 1) % timeRates.solar.length;
  }
  syncClock();
});
soundToggle.addEventListener("click", () => setSound(!settings.sound));
get("setting-sound", HTMLInputElement).addEventListener("change", (event) =>
  setSound((event.target as HTMLInputElement).checked),
);
get("setting-guides", HTMLInputElement).addEventListener("change", (event) =>
  setGuides((event.target as HTMLInputElement).checked),
);
for (const option of get("quality").querySelectorAll<HTMLInputElement>("input")) {
  option.checked = option.value === settings.quality;
  option.addEventListener("change", () => {
    if (!option.checked) return;
    settings.quality = option.value as typeof settings.quality;
    saveSettings(settings);
    flight?.setQuality(settings.quality);
  });
}
factsToggle.addEventListener("click", () => {
  const expanded = factsToggle.getAttribute("aria-expanded") !== "true";
  factsToggle.setAttribute("aria-expanded", String(expanded));
});
// On a narrow screen the card starts folded, so it does not cover the subject.
if (matchMedia("(max-width: 900px)").matches) {
  factsToggle.setAttribute("aria-expanded", "false");
}

// First-use hints follow what the visitor has already done.
world.addEventListener("pointermove", (event) => {
  if (!event.buttons) return;
  hints.did("look");
  if (hints.idle && !inside()) hints.offer("zoom");
});
world.addEventListener(
  "wheel",
  () => {
    hints.did("zoom");
    if (hints.idle && destination === "system") hints.offer("pick");
  },
  { passive: true },
);

reducedMotion.addEventListener("change", (event) => {
  playing = !event.matches;
  syncClock();
  syncLaunchMotion();
});
document.addEventListener("visibilitychange", syncLaunchMotion);

setSound(settings.sound);
get("setting-guides", HTMLInputElement).checked = settings.guides;
showLocation();
syncLaunchMotion();
if (resumeLocation) startExplorer();
