// TypeGPU aero bend + gloss material for FlightSlice.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  SURFACE_ATTRIBS,
  createTypeGpuMaterial,
  sampleSurface,
  surfaceLayout,
  surfaceRadiusMask,
} from '../engine/typegpuMaterial'
import type { MicroMaterialFactory } from '../engine/reactHost'
import type { MicroMaterial, MicroRenderer } from '../engine/webgpu'
import type { FlightTypeGpuDriver } from './FlightSlice'

export const FlightCustomUniforms = d.struct({
  aeroDir: d.vec2f,
  aeroAmt: d.f32,
  aeroReach: d.f32,
  gloss: d.f32,
})

export type FlightCustomInput = d.InferInput<typeof FlightCustomUniforms>

const flightCustomLayout = tgpu
  .bindGroupLayout({
    u: { uniform: FlightCustomUniforms },
  })
  .$idx(1)

const flightVertexFn = tgpu.vertexFn({
  in: {
    position: d.location(0, d.vec3f),
    uv: d.location(1, d.vec2f),
  },
  out: {
    pos: d.builtin.position,
    uv: d.vec2f,
    worldNormal: d.vec3f,
    localNormal: d.vec3f,
  },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const custom = flightCustomLayout.$.u
  const dir = custom.aeroDir
  const amt = custom.aeroAmt
  const reach = std.max(custom.aeroReach, 1.0)
  const s = std.dot(input.position.xy, dir)
  const t = std.clamp(s / reach, -1.0, 1.0)
  const lead = std.max(t, 0.0)
  const bow = t * t + lead * 0.45 * lead
  const dzds = (amt * (t * 2.0 + lead * 0.9)) / reach
  const nl = std.normalize(d.vec3f(dir.mul(-dzds), 1.0))
  const wn = std.normalize(frame.modelWorld.mul(d.vec4f(nl, 0.0)).xyz)
  const p = d.vec3f(input.position.xy, input.position.z + amt * bow)
  return {
    pos: frame.mvp.mul(d.vec4f(p, 1.0)),
    uv: input.uv,
    worldNormal: wn,
    localNormal: nl,
  }
})

const flightFragmentFn = tgpu.fragmentFn({
  in: {
    uv: d.vec2f,
    worldNormal: d.vec3f,
    localNormal: d.vec3f,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const custom = flightCustomLayout.$.u
  const c = sampleSurface(input.uv)
  const L = std.normalize(d.vec3f(-0.45, 0.62, 0.65))
  const baseBand = std.pow(L.z, 6.0)
  const sw = std.max(std.dot(std.normalize(input.worldNormal), L), 0.0)
  const band = std.pow(sw, 6.0) - baseBand
  const glossed = std.add(c.rgb, custom.gloss * band * c.a)
  const sl = std.max(std.dot(std.normalize(input.localNormal), L), 0.0)
  const flexBand = std.pow(sl, 6.0) - baseBand
  const flexed = glossed.mul(std.min(1.0, 2.5 * flexBand + 1.0))
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)
  const outCol = d.vec4f(flexed.mul(mask), c.a * mask)
  if (outCol.a < 0.004) {
    std.discard()
  }
  return outCol
})

export interface FlightTypeGpuMaterial extends MicroMaterial {
  readonly setUniforms: (value: FlightCustomInput) => void
}

export function createFlightTypeGpuMaterial(renderer: MicroRenderer): FlightTypeGpuMaterial {
  let writer: ((value: FlightCustomInput) => void) | null = null
  const mat = createTypeGpuMaterial(renderer, {
    doubleSided: true,
    buildPipeline: (root, colorTarget, depthStencil, primitive) =>
      root.createRenderPipeline({
        attribs: SURFACE_ATTRIBS,
        vertex: flightVertexFn,
        fragment: flightFragmentFn,
        targets: colorTarget,
        depthStencil,
        primitive,
      }),
    createExtras: (root) => {
      const customBuffer = root
        .createBuffer(FlightCustomUniforms, {
          aeroDir: [0.707, 0.707],
          aeroAmt: 0,
          aeroReach: 160,
          gloss: 0,
        })
        .$usage('uniform')
      const bg = root.unwrap(root.createBindGroup(flightCustomLayout, { u: customBuffer }))
      writer = (value) => customBuffer.write(value)
      return {
        bindGroups: () => [bg],
        dispose: () => {
          writer = null
          customBuffer.destroy()
        },
      }
    },
  })
  return {
    ...mat,
    setUniforms(value) {
      writer?.(value)
    },
  }
}

export function createFlightTypeGpuDriver(): FlightTypeGpuDriver {
  const writers = new WeakMap<MicroMaterial, (values: FlightCustomInput) => void>()
  const factory: MicroMaterialFactory = {
    sampleViewFormat: 'rgba8unorm',
    create: (renderer) => {
      const mat = createFlightTypeGpuMaterial(renderer)
      writers.set(mat, mat.setUniforms)
      return mat
    },
  }
  return {
    factory,
    writeUniforms: (material, values) => writers.get(material)?.(values),
  }
}
