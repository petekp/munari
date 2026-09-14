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

const phase = expression('t')
const eased = expression('e')
const angle = expression('ang')
const cosine = expression('ca')
const sine = expression('sa')
const rotation = SUCK_VERT.match(/rel = vec2\(([^;]+)\);/)
const position = SUCK_VERT.match(/vec3 p = vec3\(([^;]+)\);/)
if (!rotation || !position) throw new Error('Missing shader displacement')

function components(source: string): string[] {
  let depth = 0
  let start = 0
  const result: string[] = []
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '(') depth++
    if (source[index] === ')') depth--
    if (source[index] !== ',' || depth !== 0) continue
    result.push(source.slice(start, index))
    start = index + 1
  }
  return [...result, source.slice(start)]
}

const rotationComponents = components(rotation[1]!).map((value) => new Script(value))
const [positionXY, positionZ] = components(position[1]!)
if (!positionXY || !positionZ) throw new Error('Missing shader position components')
// Expand GLSL's component-wise vector arithmetic; the expressions still come
// from the vertex shader, so changing its displacement changes the oracle.
const positionComponents = [
  ...['x', 'y'].map((axis) => new Script(positionXY.replace(/\b(uCursor|rel|uSway)\b/g, `$1.${axis}`))),
  new Script(positionZ),
]

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
  const scope = {
    rel, dist, t: 0, e: 0, ang: 0, ca: 0, sa: 0,
    uT: u.phase, uLag: u.lag, uSpan: u.span, uTwist: u.twist,
    uCursor: u.cursor, uSway: u.sway, uArc: u.arc,
    clamp, max: Math.max, cos: Math.cos, sin: Math.sin, PI: Math.PI,
  }
  const context = createContext(scope)
  scope.t = phase.runInContext(context)
  scope.e = eased.runInContext(context)
  scope.ang = angle.runInContext(context)
  scope.ca = cosine.runInContext(context)
  scope.sa = sine.runInContext(context)
  const rotated = rotationComponents.map((component) => component.runInContext(context))
  rel.set(rotated[0], rotated[1])
  const coordinates = positionComponents.map((component) => component.runInContext(context))
  return {
    position: new Vector3(coordinates[0], coordinates[1], coordinates[2]),
    dist, t: scope.t, e: scope.e,
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
