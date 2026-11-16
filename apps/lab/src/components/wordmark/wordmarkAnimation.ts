export interface WordmarkOptions {
  morphMs: number;
  restMs: number;
  float: number;
  depth: number;
  dodge: number;
}

export const WORDMARK_DEFAULTS: Readonly<WordmarkOptions> = {
  morphMs: 2200 / 3,
  restMs: 1000,
  float: 0.045,
  depth: 0.33,
  dodge: 0.35,
};

export interface LetterClock {
  start: number;
  duration: number;
  nextAt: number;
}

/** Times are seconds on the visible animation clock. */
export function nextLetterClock(
  now: number,
  random: () => number,
  options: WordmarkOptions,
): LetterClock {
  const duration = (options.morphMs / 1000) * (0.8 + random() * 0.4);
  return {
    start: now,
    duration,
    nextAt: now + duration + (options.restMs / 1000) * (0.4 + random() * 1.3),
  };
}

export function letterProgress(clock: LetterClock, now: number): number {
  const t = Math.max(0, Math.min(1, (now - clock.start) / clock.duration));
  return t * t * (3 - 2 * t);
}

export function fixedLetterSlots(widths: readonly number[]): number[] {
  let left = -widths.reduce((sum, width) => sum + width, 0) / 2;
  return widths.map((width) => {
    const center = left + width / 2;
    left += width;
    return center;
  });
}

export interface LetterSpring {
  x: number;
  v: number;
}

export function stepLetterSpring(
  state: LetterSpring,
  target: number,
  dt: number,
): void {
  for (let remaining = Math.min(dt, 0.1); remaining > 0; remaining -= 1 / 120) {
    const step = Math.min(remaining, 1 / 120);
    state.v += (-90 * (state.x - target) - 12 * state.v) * step;
    state.x += state.v * step;
  }
  if (Math.abs(state.x - target) < 0.001 && Math.abs(state.v) < 0.001) {
    state.x = target;
    state.v = 0;
  }
}
