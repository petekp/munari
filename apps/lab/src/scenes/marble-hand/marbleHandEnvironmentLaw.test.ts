// Marble-hand room tests — the native field reaches only its real direction.
//
// The law: page rays travel toward -Z from the hand, and moving the hand
// changes which page cell that direction sees. The 2026-08-30 native-page
// revision must also carry source colour changes into the reflected room.
//
// Ownership: these tests pin the projection and colour transfer. Browser
// checks still own observer wiring, native input and the PMREM upload.

import { describe, expect, it } from 'vitest'
import {
  marbleEnvironmentRays,
  marblePageSample,
  nextMarbleReflectionTime,
  paintMarbleEnvironment,
  type MarblePageField,
} from './marbleHandEnvironmentLaw'

function field(red: number, green: number, blue: number): MarblePageField {
  const pixels = new Uint8ClampedArray(4 * 4 * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set([red, green, blue, 255], index)
  }
  return { pixels, width: 4, height: 4, viewportWidth: 400, viewportHeight: 400 }
}

describe('reflection update timing', () => {
  it('uses the chosen rate without delaying the first frame', () => {
    expect(nextMarbleReflectionTime(100, -Infinity, 20)).toBe(150)
    expect(nextMarbleReflectionTime(100, -Infinity, 1)).toBe(1100)
    expect(nextMarbleReflectionTime(100, -Infinity, 120)).toBeCloseTo(108.333333)
  })

  it('keeps the selected cadence across small frame timing changes', () => {
    let due = -Infinity
    let updates = 0
    for (let frame = 0; frame < 120; frame++) {
      const now = frame * 1000 / 60 + (frame % 2 ? 0.2 : 0)
      if (now < due) continue
      due = nextMarbleReflectionTime(now, due, 30)
      updates++
    }
    expect(updates).toBe(60)
  })

  it('does not accumulate catch-up work after an idle or slow frame', () => {
    expect(nextMarbleReflectionTime(5000, 50, 20)).toBe(5050)
  })
})

describe('the native page in the hand environment', () => {
  it('samples only rear-facing rays that reach the visible page', () => {
    const page = field(200, 40, 20)
    const origin = { x: 0, y: 0, z: 100 }
    expect(marblePageSample(0, 0, -1, origin, page)).toBe(40)
    expect(marblePageSample(0, 0, 1, origin, page)).toBe(-1)
    expect(marblePageSample(1, 0, 0, origin, page)).toBe(-1)
    expect(marblePageSample(1, 0, -0.1, origin, page)).toBe(-1)
  })

  it('moves the sampled cell with the hand in both page axes and depth', () => {
    const page = field(200, 40, 20)
    expect(marblePageSample(0, 0, -1, { x: -150, y: 150, z: 100 }, page)).toBe(0)
    expect(marblePageSample(0, 0, -1, { x: 150, y: -150, z: 100 }, page)).toBe(60)
    expect(marblePageSample(1, 0, -1, { x: -100, y: 0, z: 100 }, page)).toBe(40)
    expect(marblePageSample(0.5, 0, -1, { x: 0, y: 0, z: 200 }, page)).toBe(44)
  })

  it('uses Three’s rear half at u<0.5 and puts the zenith in the top canvas row', () => {
    const rays = marbleEnvironmentRays(8, 4)
    for (let x = 0; x < 8; x++) {
      expect(rays[x * 4 + 1]).toBeGreaterThan(0)
      if (x < 4) expect(rays[x * 4 + 2]).toBeLessThan(0)
      else expect(rays[x * 4 + 2]).toBeGreaterThan(0)
    }
    expect(rays[(3 * 8) * 4 + 1]).toBeLessThan(0)
  })

  it('carries changed source colours into both page reflections and room bounce', () => {
    const rays = marbleEnvironmentRays(8, 4)
    const red = new Uint8ClampedArray(8 * 4 * 4)
    const blue = new Uint8ClampedArray(red.length)
    const origin = { x: 0, y: 0, z: 100 }
    paintMarbleEnvironment(field(220, 30, 20), origin, 0.35, rays, red)
    paintMarbleEnvironment(field(20, 30, 220), origin, 0.35, rays, blue)
    const rear = (1 * 8 + 1) * 4
    const front = (1 * 8 + 5) * 4
    expect([...red.slice(rear, rear + 4)]).toEqual([220, 30, 20, 255])
    expect([...blue.slice(rear, rear + 4)]).toEqual([20, 30, 220, 255])
    expect(red[front]).toBeGreaterThan(red[front + 2])
    expect(blue[front + 2]).toBeGreaterThan(blue[front])
    paintMarbleEnvironment(field(220, 30, 20), origin, 0, rays, red)
    expect([...red.slice(front, front + 4)]).toEqual([4, 4, 4, 255])
  })

  it('encodes half white room radiance as 188 sRGB with the neutral floor', () => {
    const rays = new Float32Array([0, 0, -1, 1, 0, 0, 1, 1])
    const output = new Uint8ClampedArray(8)
    paintMarbleEnvironment(field(255, 255, 255), { x: 0, y: 0, z: 100 }, 0.5, rays, output)
    expect([...output.slice(0, 4)]).toEqual([255, 255, 255, 255])
    expect([...output.slice(4, 8)]).toEqual([188, 188, 188, 255])
  })
})
