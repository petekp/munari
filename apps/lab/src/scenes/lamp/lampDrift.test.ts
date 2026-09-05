// The idle-drift orbit's contract with the drag interaction. The pointer-up
// handler re-seeds the drift clock to now(), so the very next rAF frame
// evaluates ellipseOffset at elapsed ≈ 0. For the pointer-up comment's
// "resumes from where the drag let go" promise to hold, the curve must
// pass through the release point at phase 0 — not jump to the ellipse's
// rightmost point, which the prior cos/sin parameterization did (a
// single-frame +DRIFT_RADIUS_X teleport on release).

import { describe, expect, it } from 'vitest'
import { DRIFT_PERIOD_MS, DRIFT_RADIUS_X, DRIFT_RADIUS_Y, ellipseOffset } from './Lamp'

describe('ellipseOffset release contract', () => {
  it('pins phase 0 to the release point so a freshly re-seeded clock does not teleport the lamp', () => {
    // The bug shipped ellipseOffset(0) === (DRIFT_RADIUS_X, 0); the fix
    // makes the orbit's bottom touch the drag anchor, so phase 0 IS the
    // release point. pointer-up sets driftEpoch = now(), so the first
    // post-release frame lands here — it must be exactly (0, 0) or the
    // lamp leaves the spot the user chose on the very next paint.
    const offset = ellipseOffset(0)
    expect(offset.x).toBe(0)
    expect(offset.y).toBe(0)
  })

  it('stays within the shifted orbit so the release point is the orbit bottom, not its center', () => {
    // The fix relocates the orbit so its bottom touches the anchor: the
    // ellipse is centered at (0, DRIFT_RADIUS_Y), so y ranges [0,
    // 2·DRIFT_RADIUS_Y], never negative. The prior centered ellipse let y
    // reach -DRIFT_RADIUS_Y, which this lower bound rejects — and a
    // centered orbit can never pass through (0, 0), so reverting to it
    // would re-introduce a residual release teleport (the centered
    // minimum is 20 px). eps covers float slop where sin/cos kiss ±1.
    const eps = 1e-9
    for (let i = 0; i <= 4000; i += 1) {
      const t = (i / 4000) * DRIFT_PERIOD_MS
      const { x, y } = ellipseOffset(t)
      expect(x).toBeGreaterThanOrEqual(-DRIFT_RADIUS_X - eps)
      expect(x).toBeLessThanOrEqual(DRIFT_RADIUS_X + eps)
      expect(y).toBeGreaterThanOrEqual(-eps)
      expect(y).toBeLessThanOrEqual(2 * DRIFT_RADIUS_Y + eps)
    }
  })
})
