export type Action =
  | "toggle-time"
  | "reset"
  | "toggle-hud"
  | "open-atlas"
  | "show-help";

export type InputHandlers = {
  /** False while a dialog owns the keyboard and pointer. */
  allow(): boolean;
  /** A drag, in radians of view rotation. */
  aim(dx: number, dy: number): void;
  /** The drag ended moving at this speed, in radians per second. */
  release(vx: number, vy: number): void;
  /** Multiplies camera distance. `wheel` is the raw scroll, when there is one. */
  zoom(factor: number, wheel?: number): void;
  /** A click or tap that did not drag, in normalised device coordinates. */
  tap(x: number, y: number): void;
  /** Previous or next body along the route. */
  hop(direction: 1 | -1): void;
  /** A held key (arrows, W A S D, Q E, Shift). Returns true if it was used. */
  key(code: string, held: boolean): boolean;
  action(name: Action): void;
};

const RADIANS_PER_PIXEL = 0.005;
const heldKeys = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ShiftLeft",
  "ShiftRight",
];
const movementKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"];
const actions: Record<string, Action> = {
  Space: "toggle-time",
  KeyF: "reset",
  KeyH: "toggle-hud",
  KeyM: "open-atlas",
};

/**
 * Turns raw pointer, wheel and keyboard events on the 3D view into the handful
 * of intentions the camera understands. One rule everywhere: dragging looks,
 * scrolling and pinching zoom.
 */
export function attachInput(host: HTMLElement, handlers: InputHandlers) {
  const pointers = new Map<number, { x: number; y: number; travel: number }>();
  // Recent drag movement, to work out how fast the view was turning on release.
  let trail: { time: number; dx: number; dy: number }[] = [];
  const stop = new AbortController();
  const options = { signal: stop.signal };

  window.addEventListener(
    "keydown",
    (event) => {
      if (!handlers.allow() || !(event.target instanceof HTMLElement)) return;
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      // A focused button or slider keeps its own keys; movement still works.
      const inControl = event.target.closest("button, input, dialog, a") !== null;
      if (inControl && !movementKeys.includes(event.code)) return;

      if (heldKeys.includes(event.code)) {
        if (handlers.key(event.code, true)) event.preventDefault();
        return;
      }
      if (event.repeat) return;
      if (event.code === "PageDown" || event.code === "BracketRight") {
        event.preventDefault();
        handlers.hop(1);
      } else if (event.code === "PageUp" || event.code === "BracketLeft") {
        event.preventDefault();
        handlers.hop(-1);
      } else if (event.key === "+" || event.key === "=" || event.key === "-") {
        event.preventDefault();
        handlers.zoom(event.key === "-" ? 1.25 : 0.8);
      } else if (event.key === "?") {
        event.preventDefault();
        handlers.action("show-help");
      } else if (actions[event.code]) {
        event.preventDefault();
        handlers.action(actions[event.code]);
      }
    },
    options,
  );
  window.addEventListener(
    "keyup",
    (event) => void handlers.key(event.code, false),
    options,
  );
  window.addEventListener(
    "blur",
    () => {
      for (const code of heldKeys) handlers.key(code, false);
      pointers.clear();
    },
    options,
  );

  host.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      host.focus({ preventScroll: true });
      host.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        travel: 0,
      });
      trail = [];
      // Stop any coasting the moment the view is grabbed.
      handlers.release(0, 0);
      if (pointers.size > 1) {
        for (const pointer of pointers.values()) pointer.travel = Infinity;
      }
    },
    options,
  );
  host.addEventListener(
    "pointermove",
    (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      const next = {
        x: event.clientX,
        y: event.clientY,
        travel: previous.travel + Math.hypot(dx, dy),
      };
      if (pointers.size === 1) {
        handlers.aim(dx * RADIANS_PER_PIXEL, dy * RADIANS_PER_PIXEL);
        trail.push({ time: event.timeStamp, dx, dy });
        if (trail.length > 6) trail.shift();
      } else {
        const other = [...pointers.entries()].find(
          ([id]) => id !== event.pointerId,
        )?.[1];
        if (other) {
          const before = Math.hypot(previous.x - other.x, previous.y - other.y);
          const after = Math.hypot(next.x - other.x, next.y - other.y);
          handlers.zoom(Math.max(10, before) / Math.max(10, after));
        }
      }
      pointers.set(event.pointerId, next);
    },
    options,
  );
  host.addEventListener(
    "pointerup",
    (event) => {
      const pointer = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      if (!pointer) return;
      if (pointer.travel <= 6) {
        const bounds = host.getBoundingClientRect();
        handlers.tap(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          1 - ((event.clientY - bounds.top) / bounds.height) * 2,
        );
        return;
      }
      // Coast only if the pointer was still moving when it let go.
      const recent = trail.filter((sample) => event.timeStamp - sample.time < 90);
      if (pointers.size || recent.length < 2) return;
      const seconds = Math.max(
        0.016,
        (event.timeStamp - recent[0].time) / 1000,
      );
      const total = recent.reduce(
        (sum, sample) => ({ dx: sum.dx + sample.dx, dy: sum.dy + sample.dy }),
        { dx: 0, dy: 0 },
      );
      handlers.release(
        (total.dx * RADIANS_PER_PIXEL) / seconds,
        (total.dy * RADIANS_PER_PIXEL) / seconds,
      );
    },
    options,
  );
  for (const name of ["pointercancel", "lostpointercapture"] as const) {
    host.addEventListener(
      name,
      (event) => void pointers.delete(event.pointerId),
      options,
    );
  }
  host.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const scroll =
        event.deltaY *
        (event.deltaMode === 1 ? 36 : event.deltaMode === 2 ? host.clientHeight : 1);
      handlers.zoom(
        Math.exp(Math.min(140, Math.max(-140, scroll)) * 0.0015),
        scroll,
      );
    },
    { passive: false, signal: stop.signal },
  );

  return () => stop.abort();
}
