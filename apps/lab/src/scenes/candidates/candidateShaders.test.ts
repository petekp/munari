// Copy normals must follow the complete deformation. Detail #53's sign-only
// correction still missed radial shrink and sway by 49 degrees (2026-09-07).
// Evaluate the shader's normal expressions against independent displacement
// differences; no renderer or substituted module is involved.

import { createContext, Script } from 'node:vm'
import { Vector2, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SUCK_VERT } from './candidateShaders'

interface SuckUniforms {
  phase: number
  span: number
  arc: number
  lag: number
  twist: number
  sway: Vector2
  cursor: Vector2
}

const defaults: SuckUniforms = {
  phase: 0.65,
  span: Math.hypot(420, 180),
  arc: 90,
  lag: 0.42,
  twist: 2.6,
  sway: new Vector2(60, 0),
  cursor: new Vector2(180, 110),
}

function expression(name: string): Script {
  const match = SUCK_VERT.match(new RegExp(`(?:float|vec3) ${name} = ([\\s\\S]+?);`))
  if (!match) throw new Error(`Missing shader expression: ${name}`)
  return new Script(match[1]!)
}

const easeSlope = expression('easeSlope')
const bowSlope = expression('bowSlope')
const radialScale = expression('radialScale')
const normal = expression('deformedNormal')
const output = SUCK_VERT.match(/vNormal = ([\s\S]+?);/)
if (!output) throw new Error('Missing shader normal output')
const normalOutput = new Script(output[1]!)
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

function displaced(x: number, y: number, u: SuckUniforms) {
  const rel = new Vector2(x, y).sub(u.cursor)
  const dist = rel.length()
  const t = clamp((u.phase - u.lag * dist / Math.max(u.span, 1e-4)) / (1 - u.lag), 0, 1)
  const e = t * t * (3 - 2 * t)
  const angle = e * u.twist * (1 - clamp(dist / Math.max(u.span, 1e-4), 0, 1))
  rel.rotateAround(new Vector2(), angle)
  const bow = Math.sin(Math.PI * e)
  return {
    position: new Vector3(u.cursor.x + rel.x * (1 - e) + u.sway.x * bow,
      u.cursor.y + rel.y * (1 - e) + u.sway.y * bow, bow * u.arc),
    dist, t, e,
    dir: dist > 1e-3 ? rel.divideScalar(dist) : new Vector2(),
  }
}

function shaderNormal(x: number, y: number, u: SuckUniforms): Vector3 {
  const { dist, t, e, dir } = displaced(x, y, u)
  const scope = {
    dist, t, e, dir, uArc: u.arc, uSpan: u.span, uLag: u.lag, uSway: u.sway,
    easeSlope: 0, bowSlope: 0, radialScale: 0, deformedNormal: new Vector3(),
    PI: Math.PI, cos: Math.cos, max: Math.max,
    dot: (a: Vector2 | Vector3, b: Vector2 | Vector3) =>
      a.x * b.x + a.y * b.y + (a instanceof Vector3 && b instanceof Vector3 ? a.z * b.z : 0),
    vec3: (x: number, y: number, z: number) => new Vector3(x, y, z),
    normalize: (v: Vector3) => v.clone().normalize(),
  }
  const context = createContext(scope)
  scope.easeSlope = easeSlope.runInContext(context)
  scope.bowSlope = bowSlope.runInContext(context)
  scope.radialScale = radialScale.runInContext(context)
  scope.deformedNormal = normal.runInContext(context)
  const result = normalOutput.runInContext(context)
  if (!(result instanceof Vector3)) throw new Error('Shader normal did not produce a vector')
  return result
}

function differenceNormal(x: number, y: number, u: SuckUniforms): Vector3 | null {
  const epsilon = 1e-3
  const dx = displaced(x + epsilon, y, u).position.sub(displaced(x - epsilon, y, u).position)
  const dy = displaced(x, y + epsilon, u).position.sub(displaced(x, y - epsilon, u).position)
  const result = dx.cross(dy)
  return result.lengthSq() < 1e-20 ? null : result.normalize()
}

describe('Copy deformation normals', () => {
  it('keeps the independent displacement sample tied to the shader being checked', () => {
    expect(SUCK_VERT).toContain('float t = clamp((uT - uLag * (dist / max(uSpan, 1e-4))) / (1.0 - uLag), 0.0, 1.0);')
    expect(SUCK_VERT).toContain('float e = t * t * (3.0 - 2.0 * t);')
    expect(SUCK_VERT).toContain('float ang = e * uTwist * (1.0 - clamp(dist / max(uSpan, 1e-4), 0.0, 1.0));')
    expect(SUCK_VERT).toContain('rel = vec2(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);')
    expect(SUCK_VERT).toContain('vec3 p = vec3(uCursor + rel * (1.0 - e) + uSway * sin(PI * e), sin(PI * e) * uArc);')
  })

  it('matches the displaced tangents through shrink, both twist directions, and sideways sway', () => {
    let compared = 0
    for (const phase of [0, 0.4, 0.65, 0.8]) {
      for (const twist of [-2.6, 0, 2.6]) {
        for (const sway of [new Vector2(60, 0), new Vector2(0, 60), new Vector2(-60, 0), new Vector2(0, -60)]) {
          for (const cursor of [new Vector2(), defaults.cursor]) {
            for (const [x, y] of [[-150, 0], [100, 40], [-50, -60]] as const) {
              const u = { ...defaults, phase, twist, sway, cursor }
              const expected = differenceNormal(x, y, u)
              if (!expected) continue
              expect(shaderNormal(x, y, u).dot(expected)).toBeGreaterThan(1 - 1e-8)
              compared++
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(200)
  })

  it('keeps zero-arc and zero-lag sheets consistent with their flat geometry', () => {
    for (const overrides of [{ arc: 0 }, { lag: 0 }, { arc: 0, lag: 0 }]) {
      const u = { ...defaults, ...overrides }
      const expected = differenceNormal(100, 40, u)
      expect(expected).not.toBeNull()
      expect(shaderNormal(100, 40, u).dot(expected!)).toBeGreaterThan(1 - 1e-8)
    }
  })

  it('uses a finite front normal at the cursor and at fully collapsed points', () => {
    expect(shaderNormal(180, 110, defaults)).toEqual(new Vector3(0, 0, 1))
    expect(shaderNormal(100, 40, { ...defaults, phase: 1 })).toEqual(new Vector3(0, 0, 1))
  })
})
