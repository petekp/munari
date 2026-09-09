// Unroll motion and cleanup: an open waits for scene presentation; a close
// finishes even if opening was cancelled before its first visible frame.
// The old motion-only edge retained an invisible menu indefinitely (2026-09-07,
// Detail #39). The page owns intent and mounting; this law owns progress.

export interface RollDrive {
  open: boolean
  target: 0 | 1
  t: number
}

export function unrollStep(drive: RollDrive, delta: number, tau: number) {
  const dt = Math.min(delta, 1 / 30)
  let t = drive.t + (drive.target - drive.t) * (1 - Math.exp(-dt / tau))
  // Keep the existing 0.1% endpoint snap; the geometry must reach exact rest
  // before its owner removes it.
  if (Math.abs(drive.target - t) < 0.001) t = drive.target
  return { t, closed: !drive.open && t === 0 }
}
