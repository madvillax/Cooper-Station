import { dateFromJ2000 } from "./physics";

const YEAR = 86_400 * 365.25;

const units: [suffix: string, seconds: number][] = [
  ["d", 86_400],
  ["h", 3_600],
  ["m", 60],
  ["s", 1],
];

/** A span of time as its two largest units, e.g. "1 h 20 m" or "29.5 y". */
export function formatDuration(seconds: number) {
  if (seconds >= YEAR * 2) return `${(seconds / YEAR).toFixed(1)} y`;
  let rest = Math.max(0, Math.round(seconds));
  const first = units.findIndex(([, size]) => rest >= size);
  if (first < 0) return "0 s";
  const parts: string[] = [];
  for (const [suffix, size] of units.slice(first, first + 2)) {
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count) parts.push(`${count} ${suffix}`);
  }
  return parts.join(" ");
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** A simulation speed, in seconds of simulated time per real second. */
export function formatRate(secondsPerSecond: number) {
  if (secondsPerSecond === 1) return "Real time";
  if (secondsPerSecond < 60) return `${secondsPerSecond}×`;
  if (secondsPerSecond < 3_600) return `${secondsPerSecond / 60} min/s`;
  if (secondsPerSecond < 86_400) {
    return `${plural(secondsPerSecond / 3_600, "hour")}/s`;
  }
  return `${plural(secondsPerSecond / 86_400, "day")}/s`;
}

const months = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** The simulation date, from days since the J2000 epoch (UTC). */
export function formatDate(days: number) {
  const date = dateFromJ2000(days);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Gravitational time dilation in words. `rate` is how fast a clock here ticks
 * compared with one far from the black hole (1 = same, 0 = stopped).
 */
export function formatDilation(rate: number) {
  if (rate <= 0) return "Time stops";
  const far = 3_600 / rate;
  if (far >= YEAR * 2) return `1 h here = ${(far / YEAR).toFixed(1)} y far away`;
  if (far >= 86_400) return `1 h here = ${(far / 86_400).toFixed(1)} d far away`;
  const minutes = Math.round(far / 60);
  const padded = String(minutes % 60).padStart(2, "0");
  return `1 h here = ${Math.floor(minutes / 60)} h ${padded} m far away`;
}
