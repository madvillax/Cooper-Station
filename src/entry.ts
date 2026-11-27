const MINIMUM_CINEMATIC_MS = 2500;

/**
 * The launch sequence. It is the loading screen: while the photos drift apart
 * and the stars stretch into streaks, the 3D view is being built behind it,
 * and the status line reports what is actually happening.
 *
 * Resolves when the view may be revealed. With `cinematic` it lasts at least
 * two and a half seconds, so a fast machine does not turn it into a flash.
 * Rejects if the view could not be built; the launch page is put back as it was.
 */
export async function runEntry(options: {
  launch: HTMLElement;
  progress: HTMLElement;
  status: HTMLElement;
  bar: HTMLElement;
  stars?: { setSpeed(multiplier: number): void };
  /** False for deep links and reloads: show progress, skip the show. */
  cinematic: boolean;
  reducedMotion: boolean;
  ready: Promise<void>;
  onProgress(listener: (fraction: number, label: string) => void): void;
}) {
  const { launch, progress, status, bar, stars } = options;
  const moving = options.cinematic && !options.reducedMotion;
  progress.hidden = false;
  bar.style.transform = "scaleX(0)";
  launch.classList.add("is-loading");
  if (moving) {
    launch.classList.add("is-launching");
    stars?.setSpeed(14);
  }
  options.onProgress((fraction, label) => {
    if (status.textContent !== label) status.textContent = label;
    bar.style.transform = `scaleX(${fraction.toFixed(3)})`;
  });
  try {
    await Promise.all([
      options.ready,
      new Promise((resolve) =>
        setTimeout(resolve, moving ? MINIMUM_CINEMATIC_MS : 0),
      ),
    ]);
  } catch (error) {
    resetEntry(options);
    throw error;
  }
}

/** Puts the launch page back to its resting state. */
export function resetEntry(options: {
  launch: HTMLElement;
  progress: HTMLElement;
  stars?: { setSpeed(multiplier: number): void };
}) {
  options.launch.classList.remove("is-loading", "is-launching");
  options.progress.hidden = true;
  options.stars?.setSpeed(1);
}
