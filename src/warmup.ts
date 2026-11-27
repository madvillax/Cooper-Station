import { isSolarDestination, type Destination } from "./destinations";

export type Stage = {
  label: string;
  /** Relative share of the progress bar. */
  weight: number;
  /** A failing optional stage is skipped instead of aborting the run. */
  optional?: boolean;
  run: () => void | Promise<void>;
};

export type WarmGroup = "station" | "system" | "galaxy" | "blackhole";

const defaultOrder: WarmGroup[] = ["station", "system", "galaxy", "blackhole"];

/**
 * Yields to the browser with a macrotask. Animation frames are paused in a
 * hidden tab, so warm-up must never wait on one.
 */
export function macrotask() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export async function runStages(
  stages: Stage[],
  onProgress: (fraction: number, label: string) => void,
  pause: () => Promise<void> = macrotask,
) {
  const total = stages.reduce((sum, stage) => sum + stage.weight, 0);
  let done = 0;
  let label = "";
  for (const stage of stages) {
    label = stage.label;
    onProgress(total ? done / total : 0, label);
    try {
      await stage.run();
    } catch (error) {
      if (!stage.optional) throw error;
      console.warn(`Skipped warm-up stage "${stage.label}"`, error);
    }
    done += stage.weight;
    await pause();
  }
  onProgress(1, label);
}

export function warmGroup(destination: Destination): WarmGroup {
  if (isSolarDestination(destination)) return "system";
  return destination;
}

/** The group that owns `destination` first, then the rest in a fixed order. */
export function warmOrder(destination: Destination): WarmGroup[] {
  const first = warmGroup(destination);
  return [first, ...defaultOrder.filter((group) => group !== first)];
}
