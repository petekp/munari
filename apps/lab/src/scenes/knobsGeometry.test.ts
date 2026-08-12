import { describe, expect, it } from 'vitest'
import {
  BEZEL_LIP,
  KNOB,
  LAMP,
  PANEL_RADIUS,
  SCREW,
  SLAB_DEPTH,
  TOGGLE,
  capProfile,
  knurlRadius,
  screwProfile,
} from './knobsGeometry'

describe('knurlRadius', () => {
  it('stays within one ridge depth of the base radius', () => {
    for (let theta = 0; theta < Math.PI * 2; theta += 0.01) {
      const r = knurlRadius(theta, 26, 0.9, 40)
      expect(r).toBeGreaterThanOrEqual(26 - 0.9 - 1e-9)
      expect(r).toBeLessThanOrEqual(26 + 0.9 + 1e-9)
    }
  })

  it('repeats with period 2π/count — a full turn meets itself', () => {
    const period = (Math.PI * 2) / KNOB.knurlCount
    for (const theta of [0, 0.4, 1.1, 3.0]) {
      expect(
        knurlRadius(theta, KNOB.skirtRadius, KNOB.knurlAmp, KNOB.knurlCount),
      ).toBeCloseTo(
        knurlRadius(theta + period, KNOB.skirtRadius, KNOB.knurlAmp, KNOB.knurlCount),
        9,
      )
    }
  })

  it('reaches full ridge depth — the grip is cut, not embossed', () => {
    let max = -Infinity
    let min = Infinity
    for (let theta = 0; theta < Math.PI * 2; theta += 0.001) {
      const r = knurlRadius(theta, 26, 0.9, 40)
      max = Math.max(max, r)
      min = Math.min(min, r)
    }
    expect(max).toBeCloseTo(26.9, 3)
    expect(min).toBeCloseTo(25.1, 3)
  })
})

describe('capProfile', () => {
  const profile = capProfile(KNOB.capRadius, KNOB.capHeight)

  it('runs center → rim: radius strictly increases', () => {
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i][0]).toBeGreaterThan(profile[i - 1][0])
    }
  })

  it('runs crown → seat: height never increases', () => {
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i][1]).toBeLessThanOrEqual(profile[i - 1][1])
    }
  })

  it('starts at the spin axis at full height and seats at the rim at zero', () => {
    expect(profile[0][0]).toBeLessThan(0.01)
    expect(profile[0][1]).toBeCloseTo(KNOB.capHeight)
    expect(profile[profile.length - 1][0]).toBeCloseTo(KNOB.capRadius)
    expect(profile[profile.length - 1][1]).toBeCloseTo(0)
  })
})

describe('screwProfile', () => {
  const profile = screwProfile(SCREW.headRadius, SCREW.headHeight)

  it('runs center → rim: radius strictly increases', () => {
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i][0]).toBeGreaterThan(profile[i - 1][0])
    }
  })

  it('runs crown → seat: height never increases', () => {
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i][1]).toBeLessThanOrEqual(profile[i - 1][1])
    }
  })

  it('starts at the axis at full height and seats at the rim at zero', () => {
    expect(profile[0][0]).toBeLessThan(0.01)
    expect(profile[0][1]).toBeCloseTo(SCREW.headHeight)
    expect(profile[profile.length - 1][0]).toBeCloseTo(SCREW.headRadius)
    expect(profile[profile.length - 1][1]).toBeCloseTo(0)
  })

  it('the slot cuts into the head but not through it', () => {
    expect(SCREW.slotDepth).toBeGreaterThan(0)
    expect(SCREW.slotDepth).toBeLessThan(SCREW.headHeight)
    expect(SCREW.slotWidth).toBeLessThan(SCREW.headRadius)
  })
})

describe('the machining agrees with itself', () => {
  it('the lamp rim overlaps the glass foot — no gap ring between metal and dome', () => {
    expect(LAMP.rimRadius - LAMP.rimTube).toBeLessThan(LAMP.domeRadius)
    expect(LAMP.rimRadius + LAMP.rimTube).toBeGreaterThan(LAMP.domeRadius)
  })

  it('the emissive die sits inside its glass', () => {
    expect(LAMP.coreScale).toBeGreaterThan(0)
    expect(LAMP.coreScale).toBeLessThan(1)
  })

  it('the cap seats inside the skirt', () => {
    expect(KNOB.capRadius).toBeLessThan(KNOB.skirtRadius)
  })

  it('the lever tip clears its own collar', () => {
    expect(TOGGLE.leverLength).toBeGreaterThan(TOGGLE.collarRadius)
    expect(TOGGLE.tipRadius).toBeGreaterThan(TOGGLE.leverRadius)
  })

  it('the slab is a slab: positive depth, lip, corner, dome', () => {
    expect(SLAB_DEPTH).toBeGreaterThan(0)
    expect(BEZEL_LIP).toBeGreaterThan(0)
    expect(PANEL_RADIUS).toBeGreaterThan(0)
    expect(LAMP.domeHeight).toBeGreaterThan(0)
    expect(LAMP.domeHeight).toBeLessThanOrEqual(LAMP.domeRadius)
  })
})
