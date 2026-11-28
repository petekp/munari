// Double-sided planner sheet shader: DOM front, reverse stock show-through,
// cylinder roll shading, perforation holes, torn edge fibres, and upper-roll shadow.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  createMaterialUniformLayout,
  defineManifestMaterial,
  sampleSurface,
  surfaceLayout,
} from '@petepetrash/munari-cli/author'

const HOLE_PITCH_PX = 6.0
const HOLE_RADIUS_SQ = 1.35 * 1.35

const SheetUniformsSchema = d.struct({
  size: d.vec2f,
  _pad: d.vec2f,
  fold: d.vec4f,
  over: d.vec4f,
  // [foldOn, tearFront, overOn, 0]
  params: d.vec4f,
})

const uniformsLayout = createMaterialUniformLayout(SheetUniformsSchema)

const vertex = tgpu.vertexFn({
  in: {
    position: d.location(0, d.vec3f),
    uv: d.location(1, d.vec2f),
  },
  out: {
    pos: d.builtin.position,
    uv: d.vec2f,
  },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  return {
    pos: frame.mvp.mul(d.vec4f(input.position, 1.0)),
    uv: input.uv,
  }
})

const fragment = tgpu.fragmentFn({
  in: {
    frontFacing: d.builtin.frontFacing,
    uv: d.vec2f,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const u = uniformsLayout.$.u
  const st = input.uv
  const px = d.vec2f(st.x * u.size.x, (1.0 - st.y) * u.size.y)

  const hx = (px.x % HOLE_PITCH_PX) - HOLE_PITCH_PX * 0.5
  const inHole = hx * hx + px.y * px.y < HOLE_RADIUS_SQ
  const fibre = std.fract(std.sin(std.floor(px.x * 0.9) * 12.9898) * 43758.5453)
  const torn = px.x > u.params.y
  const ragged = torn && px.y < fibre * 2.6 + 0.6
  if (inHole || ragged) std.discard()

  const light = std.normalize(d.vec3f(-0.35, -0.5, 0.79))
  const r = std.max(u.fold.w, 0.5)
  const dist = px.x * u.fold.x + px.y * u.fold.y - u.fold.z
  const angle = std.clamp(dist / r, 0.0, Math.PI) * u.params.x
  const lightAlongFold = u.fold.x * light.x + u.fold.y * light.y
  const facing = -std.sin(angle) * lightAlongFold + std.cos(angle) * light.z
  const oriented = std.select(-facing, facing, input.frontFacing)
  const lit = oriented / light.z
  const frontShade = std.clamp(1.0 + (lit - 1.0) * 0.5, 0.55, 1.05)
  const backShade = std.clamp(0.86 + lit * 0.16, 0.74, 1.0)
  const rollShade = std.select(backShade, frontShade, input.frontFacing)
  const creaseMask = std.select(d.f32(0.0), d.f32(1.0), dist <= 0.0)
  const creaseShadow = std.smoothstep(-8.0, 0.0, dist) * creaseMask * 0.07 * u.params.x

  const ro = std.max(u.over.w, 0.5)
  const dOver = px.x * u.over.x + px.y * u.over.y - u.over.z
  const lifted = std.select(d.f32(0.0), d.f32(1.0), dOver > 0.0)
  const shadowCore = (1.0 - std.smoothstep(ro * 0.9, ro * 1.5 + 6.0, dOver)) * 0.14
  const shadowSoft = (1.0 - std.smoothstep(ro * 0.6, ro * 2.6 + 56.0, dOver)) * 0.3
  const overShadow = (shadowCore + shadowSoft) * lifted * u.params.z

  const cap = sampleSurface(st)
  const edge = std.min(std.min(px.x, u.size.x - px.x), u.size.y - px.y)
  const edgeShade = 1.0 - (1.0 - std.smoothstep(0.0, 1.5, edge)) * 0.12
  const ink = std.dot(cap.rgb, d.vec3f(0.3, 0.59, 0.11))
  const back = d.vec3f(0.93, 0.915, 0.875).mul(std.mix(1.0, ink, 0.14))
  const paper = std.select(back, cap.rgb, input.frontFacing)
  const flatShade = 1.0 - creaseShadow - overShadow
  const shade = std.select(flatShade, rollShade, dist > 0.0 && u.params.x > 0.5)
  return d.vec4f(std.clamp(paper.mul(shade * edgeShade), d.vec3f(0.0), d.vec3f(1.0)), 1.0)
})

export default defineManifestMaterial({
  name: 'tear-planner-sheet',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: true,
  depthTest: true,
  depthWrite: true,
  uniforms: {
    schema: SheetUniformsSchema,
    layout: uniformsLayout,
    initial: {
      size: [420, 594],
      _pad: [0, 0],
      fold: [0, 1, 0, 1],
      over: [0, 1, 0, 1],
      params: [0, 420, 0, 0],
    },
  },
  vertex,
  fragment,
})
