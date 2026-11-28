// Soft drop shadow cast behind a falling tear-off planner sheet.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  createMaterialUniformLayout,
  defineManifestMaterial,
  surfaceLayout,
} from '@petepetrash/munari-cli/author'

const DropShadowSchema = d.struct({
  size: d.vec2f,
  blur: d.f32,
  strength: d.f32,
})

const uniformsLayout = createMaterialUniformLayout(DropShadowSchema)

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
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const u = uniformsLayout.$.u
  const px = d.vec2f(input.uv.x * u.size.x, input.uv.y * u.size.y)
  const edge = std.min(std.min(px.x, u.size.x - px.x), std.min(px.y, u.size.y - px.y))
  const alpha = std.smoothstep(0.0, std.max(u.blur, 0.5), edge) * u.strength
  if (alpha < 0.002) std.discard()
  return d.vec4f(0.0, 0.0, 0.0, alpha)
})

export default defineManifestMaterial({
  name: 'tear-planner-drop-shadow',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthTest: true,
  depthWrite: false,
  uniforms: {
    schema: DropShadowSchema,
    layout: uniformsLayout,
    initial: { size: [420, 594], blur: 24, strength: 0 },
  },
  vertex,
  fragment,
})
