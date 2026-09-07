// Lamp drift starts at the drag's release point. The old cosine origin
// added 34px on the first free frame (2026-09-07, Detail #57). The component
// owns the anchor and clock; this law supplies only the release-relative offset.

// Preserve the original ellipse radii and 22-second period; its phase now
// starts at zero displacement so restarting the clock cannot move the lamp.
const DRIFT_RADIUS_X = 34
const DRIFT_RADIUS_Y = 20
const DRIFT_PERIOD_MS = 22000

export function lampDriftOffset(elapsedMs: number) {
  const angle = (elapsedMs / DRIFT_PERIOD_MS) * Math.PI * 2
  return { x: Math.sin(angle) * DRIFT_RADIUS_X, y: (1 - Math.cos(angle)) * DRIFT_RADIUS_Y }
}
