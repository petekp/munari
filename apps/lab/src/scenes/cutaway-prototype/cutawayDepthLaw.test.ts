import { describe, expect, it } from 'vitest'
import { cutDepthAt, projectOntoSheet, stationIndexAt, type CutStation } from './cutawayDepthLaw'

const stations: readonly CutStation[] = [
  { scroll: 0, depth: 15 },
  { scroll: 300, depth: 4 },
  { scroll: 700, depth: -12 },
]

describe('cutDepthAt', () => {
  it('stands at each station when its heading reaches the reading line', () => {
    expect(stations.map((s) => cutDepthAt(s.scroll, stations))).toEqual([15, 4, -12])
  })

  it('cuts between two parts when the reader stops between their headings', () => {
    expect(cutDepthAt(500, stations)).toBeCloseTo(-4)
  })

  it('never cuts past the first or last part', () => {
    expect(cutDepthAt(-50, stations)).toBe(15)
    expect(cutDepthAt(5000, stations)).toBe(-12)
  })
})

describe('stationIndexAt', () => {
  it('names the deepest part the plane has passed', () => {
    expect(stationIndexAt(15, stations)).toBe(0)
    expect(stationIndexAt(4.5, stations)).toBe(0)
    expect(stationIndexAt(4, stations)).toBe(1)
    expect(stationIndexAt(-20, stations)).toBe(2)
  })
})

describe('projectOntoSheet', () => {
  const lens = { principalZ: 30, focalLength: 26, apertureRadius: 6.5 }

  it('is sharp only on the focal plane', () => {
    expect(projectOntoSheet(4, lens).blurRadius).toBeCloseTo(0)
    expect(projectOntoSheet(10, lens).blurRadius).toBeCloseTo(1.5)
    expect(projectOntoSheet(-2, lens).blurRadius).toBeCloseTo(1.5)
  })

  it('dims the image as the sheet moves away from the lens', () => {
    expect(projectOntoSheet(15, lens).irradiance).toBeGreaterThan(projectOntoSheet(4, lens).irradiance)
  })
})
