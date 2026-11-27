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
