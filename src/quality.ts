export type Tier = "low" | "balanced" | "high";

export type TierSettings = {
  /** Fraction of the capped device pixel ratio to render at. */
  scale: number;
  /** Render to a floating-point target with post-processing. */
  hdr: boolean;
  bloom: boolean;
  /** Station sun shadow map size; 0 turns the shadow off. */
  shadowSize: 0 | 1024 | 2048;
  /** Ray-march steps for the Gargantua lens. */
  lensSteps: number;
};

export const tierSettings: Record<Tier, TierSettings> = {
  // Low draws straight to the screen, exactly as the app did before the HDR
  // pipeline existed, so it is never heavier than the original renderer.
  low: { scale: 0.6, hdr: false, bloom: false, shadowSize: 0, lensSteps: 48 },
  balanced: { scale: 0.8, hdr: true, bloom: true, shadowSize: 1024, lensSteps: 96 },
  high: { scale: 1, hdr: true, bloom: true, shadowSize: 2048, lensSteps: 160 },
};

const order: Tier[] = ["low", "balanced", "high"];
const WINDOW_MS = 2000;
const MIN_SAMPLES = 30;
const WINDOWS_TO_STEP_DOWN = 2;
const WINDOWS_TO_STEP_UP = 5;
const MIN_GAP_MS = 4000;
const RETURN_BLOCK_MS = 60_000;

/**
 * Chooses a quality tier from measured load, where load is frame cost divided
 * by the frame budget (1 or more means frames are being missed).
 *
 * It judges two-second windows by their median, so one long frame (a hitch, a
 * tab switch) cannot move it, and it needs several windows in a row to act.
 * `upThreshold` is how light a window must be to count toward stepping up:
 * about 0.5 when load comes from real GPU timings, close to 1 when it can only
 * be inferred from frame intervals, which never drop below the display rate.
 */
export function createGovernor(options: { initial: Tier; upThreshold: number }) {
  let tier = options.initial;
  let pinned = false;
  let windowStart: number | null = null;
  let samples: number[] = [];
  let heavyWindows = 0;
  let lightWindows = 0;
  let lastChange = -Infinity;
  const blockedUntil = new Map<Tier, number>();

  function discard() {
    windowStart = null;
    samples = [];
    heavyWindows = lightWindows = 0;
  }

  function closeWindow() {
    if (samples.length >= MIN_SAMPLES) {
      samples.sort((a, b) => a - b);
      const median = samples[samples.length >> 1];
      if (median > 1) {
        heavyWindows++;
        lightWindows = 0;
      } else if (median < options.upThreshold) {
        lightWindows++;
        heavyWindows = 0;
      } else {
        heavyWindows = lightWindows = 0;
      }
    }
    samples = [];
  }

  function change(next: Tier, now: number) {
    tier = next;
    lastChange = now;
    heavyWindows = lightWindows = 0;
    return tier;
  }

  return {
    get tier() {
      return tier;
    },
    /** Records one frame. Returns the new tier when it changes, else null. */
    sample(load: number, nowMs: number): Tier | null {
      if (pinned) return null;
      windowStart ??= nowMs;
      samples.push(load);
      if (nowMs - windowStart < WINDOW_MS) return null;
      closeWindow();
      windowStart = nowMs;
      if (nowMs - lastChange < MIN_GAP_MS) return null;
      const index = order.indexOf(tier);
      if (heavyWindows >= WINDOWS_TO_STEP_DOWN && index > 0) {
        blockedUntil.set(tier, nowMs + RETURN_BLOCK_MS);
        return change(order[index - 1], nowMs);
      }
      const above = order[index + 1];
      if (
        lightWindows >= WINDOWS_TO_STEP_UP &&
        above &&
        nowMs >= (blockedUntil.get(above) ?? -Infinity)
      ) {
        return change(above, nowMs);
      }
      return null;
    },
    /** Drops the window in progress, e.g. after a tab switch or a resize. */
    discard,
    /** Fixes the tier, or hands control back with "auto". */
    pin(next: Tier | "auto"): Tier | null {
      discard();
      pinned = next !== "auto";
      if (next === "auto" || next === tier) return null;
      tier = next;
      return tier;
    },
  };
}
