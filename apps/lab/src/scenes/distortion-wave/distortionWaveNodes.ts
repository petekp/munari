// Wave material — a clipped lens, flowing color band and lingering edge light.
// Adapted from distortion-wave 0.2.0; public/licenses/distortion-wave.txt carries its MIT license.
import { Color, Vector2, Vector3, type Texture } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  atan,
  clamp,
  cos,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  sign,
  sin,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput } from '@petepetrash/munari'

export const WAVE_PALETTES = {
  Aurora: ['#FF4FD8', '#A35BFF', '#5B7CFF', '#38D9FF', '#FFD36B', '#FF7A5C'],
  Ocean: ['#3A7BFF', '#2EE6D6', '#7C5CFF', '#1FB6FF', '#B8F2FF'],
  Mint: ['#2BD67B', '#B6FF5C', '#1FC8A9', '#E8FFB0', '#3CE0C0'],
  Ember: ['#FF5A3C', '#FFB23C', '#FF3C8E', '#FFE07A', '#FF7F50'],
  Gold: ['#ffc53d', '#ff9f43', '#ff6b6b'],
} as const
export type WavePalette = keyof typeof WAVE_PALETTES

function toOklab(value: string): Vector3 {
  const { r, g, b } = new Color(value)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return new Vector3(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  )
}

export function createDistortionWaveMaterial(snapshot: Texture) {
  const map = texture(snapshot)
  const size = uniform(new Vector2(1, 1)),
    origin = uniform(new Vector2())
  const time = uniform(0),
    tilt = uniform(0),
    squash = uniform(1),
    spine = uniform(0),
    front = uniform(0)
  const scale = uniform(1),
    swell = uniform(0),
    energy = uniform(0),
    glow = uniform(0),
    rim = uniform(0)
  const clear = uniform(0),
    hairClear = uniform(0),
    ring = uniform(1),
    launched = uniform(0)
  const amplitude = uniform(20),
    lensWidth = uniform(90),
    aberration = uniform(0.35),
    lead = uniform(80),
    tail = uniform(180)
  const rimWidth = uniform(14),
    rimSoftness = uniform(200),
    seam = uniform(48),
    radius = uniform(0),
    boxless = uniform(0)
  const pixelRatio = uniform(1)
  const visibility = uniform(0),
    background = uniform(new Color('#131316'))
  const paletteValues = Array.from({ length: 8 }, () => new Vector3())
  const palette = uniformArray<'vec3'>(paletteValues, 'vec3'),
    paletteCount = uniform(6, 'int')
  const at = uv(),
    point = vec2(at.x, float(1).sub(at.y)).mul(size)
  const offset = point.sub(origin),
    cosine = cos(tilt),
    sine = sin(tilt)
  const q = vec2(
    cosine.mul(offset.x).add(sine.mul(offset.y)),
    cosine.mul(offset.y).sub(sine.mul(offset.x)),
  )
  const mx = q.x.mul(squash)
  const v = vec2(max(abs(mx).sub(spine), 0), q.y)
  const distance = max(length(v), 0.001)
  const gradient = vec2(v.x.mul(sign(q.x)).mul(squash), v.y).div(distance)
  const gain = max(length(gradient), 0.001)
  const normal = vec2(
    cosine.mul(gradient.x).sub(sine.mul(gradient.y)),
    sine.mul(gradient.x).add(cosine.mul(gradient.y)),
  ).div(gain)
  const angle = atan(q.y, q.x)
  const wobble = sin(angle.mul(3).add(time.mul(1.3)))
    .mul(0.5)
    .add(sin(angle.mul(5).sub(time.mul(0.9)).add(2.1)).mul(0.3))
    .add(sin(angle.mul(2).add(time.mul(2))).mul(0.2))
  const d = distance.sub(front).div(gain).add(swell.mul(wobble))
  const lens = exp(
    d
      .div(lensWidth.mul(d.greaterThan(0).select(0.8, 1.6)))
      .abs()
      .pow(2)
      .negate(),
  )
  const bulge = normal.mul(energy.mul(amplitude).mul(lens))
  const sampleAt = at.sub(vec2(bulge.x, bulge.y.negate()).div(size))
  const split = vec2(bulge.x, bulge.y.negate())
    .div(size)
    .mul(aberration)
    .mul(0.5)
  const red = map.sample(clamp(sampleAt.add(split), 0, 1)),
    green = map.sample(clamp(sampleAt, 0, 1)),
    blue = map.sample(clamp(sampleAt.sub(split), 0, 1))
  const cover = mix(float(1), smoothstep(seam.negate(), seam, d), launched)
  const warpedColor = vec3(red.r, green.g, blue.b)
  const half = size.mul(0.5),
    center = point.sub(half)
  const corner = min(radius, min(half.x, half.y))
  const box = abs(center).sub(half).add(corner)
  const sd = length(max(box, 0))
    .add(min(max(box.x, box.y), 0))
    .sub(corner)
  const mask = clamp(float(0.5).sub(sd.mul(pixelRatio)), 0, 1)
  const oldColor = mix(map.sample(at).rgb, warpedColor, mask).mul(cover)
  const inset = max(sd.negate(), 0)
  const lobes = sin(angle.mul(2).add(time.mul(1.4)))
    .mul(cos(angle.sub(time.mul(0.6)).add(0.8)))
    .mul(0.5)
    .add(0.5)
  const ahead = exp(d.div(lead).abs().pow(2).mul(-4.5))
  const behind = float(1)
    .sub(clamp(d.negate().div(tail.mul(mix(0.55, 1.35, lobes))), 0, 1))
    .pow(2.4)
  const band = d
    .greaterThanEqual(0)
    .select(ahead, behind)
    .mul(glow)
    .mul(mix(0.9, 0.75, ring))
  const around = atan(center.y.div(size.y), center.x.div(size.x))
  const lumps = sin(around.mul(3).add(time.mul(0.7)))
    .mul(0.5)
    .add(sin(around.mul(5).sub(time.mul(1.2)).add(2)).mul(0.3))
  const thickness = max(float(1).add(lumps.mul(0.55)), 0.15)
  const reached = float(1).sub(smoothstep(lead.mul(-0.6), lead.mul(0.4), d))
  const kept = smoothstep(
    rimSoftness.negate(),
    rimSoftness,
    d.add(front.sub(clear).div(gain)),
  )
  const edgeLight = exp(
    inset.div(rimWidth.mul(thickness)).abs().pow(2).negate(),
  )
    .mul(reached)
    .mul(kept)
    .mul(rim)
    .mul(float(1).sub(boxless))
  const hair = float(1)
    .sub(smoothstep(0.75, 1.55, inset))
    .mul(reached)
    .mul(
      smoothstep(
        rimSoftness.negate(),
        rimSoftness,
        d.add(front.sub(hairClear).div(gain)),
      ),
    )
    .mul(rim)
    .mul(0.85)
    .mul(float(1).sub(boxless)).mul(mask)
  const ink = clamp(length(map.sample(at).rgb.sub(background.rgb)).mul(6), 0, 1)
  const alpha = clamp(
    float(1).sub(float(1).sub(band).mul(float(1).sub(edgeLight))),
    0,
    0.94,
  ).mul(mix(1, ink, boxless)).mul(mask)
  const flow = angle
    .div(Math.PI * 2)
    .add(time.mul(0.12))
    .add(d.mul(0.0016).div(scale))
    .add(0.6)
  const phase = fract(flow).mul(paletteCount),
    index = floor(phase).toInt()
  const lab = mix(
    palette.element(index),
    palette.element(mod(index.add(1), paletteCount)),
    smoothstep(0, 1, fract(phase)),
  )
  const lightness = lab.x
    .add(
      exp(d.sub(scale.mul(28)).div(scale.mul(48)).abs().pow(2).negate()).mul(
        0.1,
      ),
    )
    .sub(
      exp(d.add(scale.mul(90)).div(scale.mul(70)).abs().pow(2).negate()).mul(
        0.12,
      ),
    )
  const pearl = exp(
    d
      .add(scale.mul(6))
      .div(max(scale.mul(24), 3))
      .abs()
      .pow(2)
      .negate(),
  ).mul(0.65)
  const shaded = mix(
    vec3(lightness, lab.y.mul(1.2), lab.z.mul(1.2)),
    vec3(0.985, 0, 0),
    pearl,
  )
  const l = shaded.x
    .add(shaded.y.mul(0.3963377774))
    .add(shaded.z.mul(0.2158037573))
  const m = shaded.x
    .sub(shaded.y.mul(0.1055613458))
    .sub(shaded.z.mul(0.0638541728))
  const s = shaded.x
    .sub(shaded.y.mul(0.0894841775))
    .sub(shaded.z.mul(1.291485548))
  const l3 = l.mul(l).mul(l),
    m3 = m.mul(m).mul(m),
    s3 = s.mul(s).mul(s)
  const color = clamp(
    vec3(
      l3.mul(4.0767416621).sub(m3.mul(3.3077115913)).add(s3.mul(0.2309699292)),
      l3.mul(-1.2684380046).add(m3.mul(2.6097574011)).sub(s3.mul(0.3413193965)),
      l3.mul(-0.0041960863).sub(m3.mul(0.7034186147)).add(s3.mul(1.707614701)),
    ),
    0,
    1,
  )
  const rgb = oldColor.mul(float(1).sub(alpha)).add(color.mul(alpha))
  const outputAlpha = cover.mul(float(1).sub(alpha)).add(alpha)
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  })
  material.outputNode = premultipliedOutput(
    vec4(
      mix(rgb, mix(color, vec3(1), 0.75), hair),
      outputAlpha.mul(float(1).sub(hair)).add(hair),
    )
      .mul(visibility),
  )
  return {
    material,
    size,
    origin,
    time,
    tilt,
    squash,
    spine,
    front,
    scale,
    swell,
    energy,
    glow,
    rim,
    clear,
    hairClear,
    ring,
    launched,
    amplitude,
    lensWidth,
    aberration,
    lead,
    tail,
    rimWidth,
    rimSoftness,
    seam,
    radius,
    boxless,
    visibility,
    pixelRatio,
    background,
    setPalette(name: WavePalette) {
      const colors = WAVE_PALETTES[name]
      paletteCount.value = colors.length
      paletteValues.forEach((value, i) =>
        value.copy(toOklab(colors[i % colors.length])),
      )
    },
  }
}
