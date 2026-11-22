import { describe, expect, it } from 'vitest'
import {
  bounceOffsetBounds,
  bouncePresetOffset,
  clampBounceOffset,
  computeBounceSeamGaps,
  type BounceStageMetrics,
} from './frontierBounceLaw'

const DESKTOP_STAGE: BounceStageMetrics = {
  stageWidth: 1200,
  stageHeight: 620,
  emitterWidth: 440,
  emitterHeight: 320,
  laneLeft: 236,
  laneTop: 60,
  laneRight: 940,
  laneBottom: 536,
}

describe('frontierBounceLaw', () => {
  it('clamps arbitrary drag deltas cleanly inside the reflective chrome lane', () => {
    const bounds = bounceOffsetBounds(DESKTOP_STAGE)
    expect(bounds.minX).toBe(-126)
    expect(bounds.maxX).toBe(126)
    expect(bounds.minY).toBe(-72)
    expect(bounds.maxY).toBe(72)

    expect(clampBounceOffset({ x: -900, y: 500 }, DESKTOP_STAGE)).toEqual({
      x: -126,
      y: 72,
    })
  })

  it('places hug-nav and hug-inspector presets at symmetric 6 px contact seams', () => {
    const navPose = bouncePresetOffset('hug-nav', DESKTOP_STAGE)
    const navGaps = computeBounceSeamGaps(navPose, DESKTOP_STAGE)
    expect(navGaps.leftPx).toBe(6)
    expect(navGaps.rightPx).toBe(258)

    const inspPose = bouncePresetOffset('hug-inspector', DESKTOP_STAGE)
    const inspGaps = computeBounceSeamGaps(inspPose, DESKTOP_STAGE)
    expect(inspGaps.rightPx).toBe(6)
    expect(inspGaps.leftPx).toBe(258)
  })

  it('snaps downward toward a stacked mobile inspector when inspectorBelow is true', () => {
    const mobile: BounceStageMetrics = {
      stageWidth: 378,
      stageHeight: 560,
      emitterWidth: 196,
      emitterHeight: 172,
      laneLeft: 124,
      laneTop: 52,
      laneRight: 370,
      laneBottom: 312,
      inspectorBelow: true,
      inspectorEdgePx: 360,
    }
    const pose = bouncePresetOffset('hug-inspector', mobile)
    expect(pose).toEqual({ x: 0, y: 38 })
    const gaps = computeBounceSeamGaps(pose, mobile)
    expect(gaps.rightPx).toBe(54)
  })
})
