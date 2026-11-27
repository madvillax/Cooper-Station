import { orbital, overviewSize, radiusKm } from "./bodies-data";
import {
  destinationInfo,
  solarRoute,
  type Destination,
  type SolarDestination,
} from "./destinations";

export type FactRow = { label: string; value: string; live?: boolean };

function css(color: number) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * Fills the data card. Rows are reused when the labels have not changed, so
 * the figures that update several times a second only touch text nodes.
 */
export function renderFacts(list: HTMLElement, rows: FactRow[]) {
  const signature = rows.map((row) => row.label).join("|");
  if (list.dataset.rows !== signature) {
    list.dataset.rows = signature;
    list.replaceChildren(
      ...rows.flatMap((row) => {
        const term = document.createElement("dt");
        term.textContent = row.label;
        const value = document.createElement("dd");
        if (row.live) value.dataset.live = "";
        return [term, value];
      }),
    );
  }
  const values = list.querySelectorAll("dd");
  rows.forEach((row, index) => {
    if (values[index].textContent !== row.value) {
      values[index].textContent = row.value;
    }
  });
}

/**
 * The route rail: the Sun and planets on a ruler of real distance. The scale
 * is logarithmic, because on a linear one the four inner planets would share
 * a few pixels and Neptune would own a third of the rail.
 */
export function createRail(
  nav: HTMLElement,
  overviewIcon: string,
  onSelect: (id: SolarDestination) => void,
) {
  const stops = new Map<SolarDestination, HTMLButtonElement>();
  const overview = document.createElement("button");
  overview.type = "button";
  overview.className = "tool";
  overview.innerHTML = overviewIcon;
  overview.title = "Whole Solar System";
  overview.setAttribute("aria-label", "Whole Solar System");
  overview.addEventListener("click", () => onSelect("system"));
  stops.set("system", overview);

  const track = document.createElement("div");
  track.className = "rail-track";
  const inner = Math.log(0.22);
  const span = Math.log(orbital.neptune.au) - inner;
  for (const id of solarRoute) {
    if (id === "system") continue;
    const info = destinationInfo(id);
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "rail-stop";
    stop.setAttribute("aria-label", info.name);
    const at = id === "sun" ? 0 : (Math.log(orbital[id].au) - inner) / span;
    stop.style.setProperty("--at", at.toFixed(4));
    stop.style.setProperty(
      "--size",
      `${Math.min(14, 4 + overviewSize(radiusKm[id]) * 5).toFixed(1)}px`,
    );
    stop.style.setProperty("--body-color", css(info.color));
    const name = document.createElement("span");
    name.className = "rail-name";
    name.textContent = info.name;
    name.setAttribute("aria-hidden", "true");
    stop.append(name);
    stop.addEventListener("click", () => onSelect(id));
    stops.set(id, stop);
    track.append(stop);
  }
  nav.append(overview, track);

  return {
    setCurrent(current: Destination) {
      for (const [id, stop] of stops) {
        if (id === current) stop.setAttribute("aria-current", "true");
        else stop.removeAttribute("aria-current");
      }
    },
  };
}

/** Name labels that follow bodies in the 3D view. Clicking one flies there. */
export function createLabels(
  container: HTMLElement,
  onSelect: (id: Destination) => void,
) {
  const labels = new Map<string, HTMLElement>();
  function label(id: string) {
    let element = labels.get(id);
    if (element) return element;
    if (id === "sol") {
      element = document.createElement("span");
      element.textContent = "The Sun is here";
    } else {
      const destination = id as Destination;
      const button = document.createElement("button");
      button.type = "button";
      // Reachable by pointer and screen reader; the rail and the Atlas already
      // give keyboard users every destination.
      button.tabIndex = -1;
      button.textContent = destinationInfo(destination).name;
      button.setAttribute("aria-label", `Fly to ${button.textContent}`);
      button.addEventListener("click", () => onSelect(destination));
      element = button;
    }
    element.className = "body-label";
    element.hidden = true;
    container.append(element);
    labels.set(id, element);
    return element;
  }

  return {
    update(points: { id: string; x: number; y: number; visible: boolean }[]) {
      for (const point of points) {
        const element = label(point.id);
        if (element.hidden === point.visible) element.hidden = !point.visible;
        if (!point.visible) continue;
        // Centred under the body; translate3d keeps it on the compositor.
        element.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0) translateX(-50%)`;
      }
    },
  };
}

/** A thumb stick for touch: reports each axis from -1 to 1, forward positive. */
export function createStick(
  pad: HTMLElement,
  knob: HTMLElement,
  onMove: (x: number, y: number) => void,
) {
  let active: number | null = null;

  function place(event: PointerEvent) {
    const bounds = pad.getBoundingClientRect();
    const reach = bounds.width / 2 - 20;
    let x = event.clientX - (bounds.left + bounds.width / 2);
    let y = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(x, y);
    if (distance > reach) {
      x *= reach / distance;
      y *= reach / distance;
    }
    knob.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    onMove(x / reach, -y / reach);
  }

  function release(event: PointerEvent) {
    if (event.pointerId !== active) return;
    active = null;
    knob.style.transform = "";
    onMove(0, 0);
  }

  pad.addEventListener("pointerdown", (event) => {
    if (active !== null) return;
    active = event.pointerId;
    pad.setPointerCapture(event.pointerId);
    place(event);
  });
  pad.addEventListener("pointermove", (event) => {
    if (event.pointerId === active) place(event);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    pad.addEventListener(name, release);
  }
}

const hintText = {
  look: "Drag to look around",
  zoom: "Scroll or pinch to zoom",
  pick: "Click a planet to fly there",
} as const;
export type HintKey = keyof typeof hintText;

/**
 * First-use hints: one line at a time, each shown once and removed the moment
 * the visitor does the thing it describes.
 */
export function createHints(element: HTMLElement) {
  const done = new Set<HintKey>();
  let showing: HintKey | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    showing = null;
    element.hidden = true;
    clearTimeout(timeout);
  }

  return {
    /** Shows a hint unless it has already been shown or another is up. */
    offer(key: HintKey) {
      if (done.has(key) || showing) return;
      showing = key;
      done.add(key);
      element.textContent = hintText[key];
      element.hidden = false;
      // Not everyone will act on it; do not leave it up for good.
      timeout = setTimeout(hide, 12_000);
    },
    /** The visitor did it: never show this hint (again). */
    did(key: HintKey) {
      done.add(key);
      if (showing === key) hide();
    },
    get idle() {
      return showing === null;
    },
  };
}
