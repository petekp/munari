// Distortion wave — a captured before-state refracts away to reveal native HTML.
// The snapshot belongs to this scene; Munari's source texture remains borrowed.
import { Color, Vector2, Vector4, type Texture } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  clamp,
  cos,
  exp,
  float,
  length,
  max,
  min,
  mix,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput } from '@petepetrash/munari'

export const WAVE_PALETTES = {
  Aurora: ['#9c64ff', '#5ce1e6', '#ff92d5'],
  Ocean: ['#4275ff', '#49e5d7', '#b3f5ff'],
  Ember: ['#ff604e', '#ffd46e', '#f786c8'],
} as const
export type WavePalette = keyof typeof WAVE_PALETTES

export function createDistortionWaveMaterial(snapshot: Texture) {
  const map = texture(snapshot)
  const size = uniform(new Vector2(1, 1))
  const box = uniform(new Vector4(0, 0, 1, 1))
  const origin = uniform(new Vector2())
  const progress = uniform(0)
  const intensity = uniform(1)
  const radius = uniform(20)
  const colors = WAVE_PALETTES.Aurora.map((value) => uniform(new Color(value)))
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  })
  const at = uv()
  const point = vec2(at.x, float(1).sub(at.y)).mul(size)
  const offset = point.sub(origin)
  const distance = max(length(offset), 0.001)
  const direction = offset.div(distance)
  const extent = max(
    length(origin.sub(box.xy)),
    max(
      length(origin.sub(box.xy.add(box.zw))),
      max(
        length(origin.sub(box.xy.add(vec2(box.z, 0)))),
        length(origin.sub(box.xy.add(vec2(0, box.w)))),
      ),
    ),
  )
  const width = clamp(min(box.z, box.w).mul(0.25), 16, 85)
  const travel = progress.mul(float(2).sub(progress))
  const front = travel.mul(extent.add(width.mul(5))).sub(width.mul(2.5))
  const wobble = sin(direction.x.mul(4).add(progress.mul(8)))
    .mul(sin(direction.y.mul(5)))
    .mul(width)
    .mul(0.1)
  const edge = distance.sub(front).add(wobble)
  const lens = exp(edge.div(width).pow(2).negate())
  const envelope = smoothstep(0, 0.06, progress).mul(
    float(1).sub(smoothstep(0.65, 1, progress)),
  )
  const bend = direction.mul(
    lens.mul(width).mul(0.32).mul(intensity).mul(envelope),
  )
  const sampleUv = at.sub(vec2(bend.x, bend.y.negate()).div(size))
  const split = vec2(bend.x, bend.y.negate()).div(size).mul(0.4)
  const blur = lens.mul(envelope).mul(intensity).mul(2.5).div(size)
  const center = map.sample(clamp(sampleUv, 0, 1))
  const red = map.sample(clamp(sampleUv.add(split).add(blur), 0, 1))
  const blue = map.sample(clamp(sampleUv.sub(split).sub(blur), 0, 1))
  const oldColor = vec3(red.r, center.g, blue.b)
  const oldAlpha = smoothstep(width.mul(-0.35), width.mul(0.35), edge)
  const phase = point.x
    .div(max(box.z, 1))
    .mul(5)
    .add(point.y.div(max(box.w, 1)).mul(3))
    .add(progress.mul(5))
  const hue = mix(colors[0], colors[1], sin(phase).mul(0.5).add(0.5))
  const rainbow = mix(hue, colors[2], cos(phase.mul(0.7)).mul(0.5).add(0.5))
  const local = abs(point.sub(box.xy.add(box.zw.mul(0.5))))
    .sub(box.zw.mul(0.5))
    .add(radius)
  const shapeDistance = length(max(local, 0))
    .add(min(max(local.x, local.y), 0))
    .sub(radius)
  const mask = float(1).sub(smoothstep(-0.75, 0.75, shapeDistance))
  const rim = exp(abs(shapeDistance).div(5).pow(2).negate()).mul(lens).mul(0.65)
  const glow = clamp(
    lens.mul(0.78).add(rim).mul(envelope).mul(intensity),
    0,
    0.94,
  )
  const highlight = exp(edge.div(width.mul(0.12)).pow(2).negate())
    .mul(envelope)
    .mul(0.5)
  const light = mix(rainbow, vec3(1), highlight)
  const alpha = oldAlpha.mul(center.a)
  const outputAlpha = alpha.mul(float(1).sub(glow)).add(glow)
  const rgb = oldColor
    .mul(oldAlpha)
    .mul(float(1).sub(glow))
    .add(light.mul(glow))
  material.outputNode = premultipliedOutput(vec4(rgb, outputAlpha).mul(mask))
  return { material, size, box, origin, progress, intensity, radius, colors }
}
