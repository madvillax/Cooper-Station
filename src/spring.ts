export type Spring = { value: number; velocity: number };

/**
 * Advances a critically damped spring toward `target`. The update is the exact
 * solution over `dt`, so the result does not depend on the frame rate.
 * `halfLife` is the time in seconds to close half the remaining gap.
 */
export function stepSpring(
  spring: Spring,
  target: number,
  halfLife: number,
  dt: number,
) {
  if (dt <= 0) return;
  if (halfLife <= 0) {
    spring.value = target;
    spring.velocity = 0;
    return;
  }
  const omega = (2 * Math.LN2) / halfLife;
  const offset = spring.value - target;
  const decay = Math.exp(-omega * dt);
  const drift = (spring.velocity + omega * offset) * dt;
  spring.velocity = (spring.velocity - omega * drift) * decay;
  spring.value = target + (offset + drift) * decay;
}
