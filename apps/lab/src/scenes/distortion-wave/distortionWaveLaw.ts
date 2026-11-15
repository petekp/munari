// Wave motion — source-shaped launch, refraction, and a separately fading rim.
// Adapted from distortion-wave 0.2.0; public/licenses/distortion-wave.txt carries its MIT license.
export interface WaveGeometry {
  width: number
  height: number
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  touchX: number
  touchY: number
  local: boolean
}

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function bezier(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const at = (t: number, p1: number, p2: number) =>
    3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3
  let low = 0,
    high = 1
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2
    if (at(middle, x1, x2) < clamp(x)) low = middle
    else high = middle
  }
  return at((low + high) / 2, y1, y2)
}

export interface WaveTiming {
  duration: number
  buildupDuration: number
  buildupDisplacement: number
}

export function createWaveMotion(geometry: WaveGeometry, timing: WaveTiming) {
  const g = geometry
  const vertical = !g.local && g.sourceWidth >= g.sourceHeight * 1.4
  const horizontal = !g.local && g.sourceHeight >= g.sourceWidth * 1.4
  const ring = !vertical && !horizontal
  const scale = clamp(Math.sqrt(g.width * g.height) / 516, 0.12, 1.8)
  const travel = ring ? 3.2 : 2.2
  const linger = ring ? -0.2 : -0.3
  const rimFade = ring ? 2.4 : 2.8
  const hairDelay = ring ? 0.9 : 0.45
  const flightTime = Math.max(
    travel * 0.6,
    linger + rimFade,
    linger + hairDelay + 2.8,
  )
  const anticipation =
    (flightTime * timing.buildupDuration) /
    Math.max(1, timing.duration - timing.buildupDuration)
  const total = anticipation + flightTime
  const minRadius = Math.max(Math.min(g.sourceWidth, g.sourceHeight) / 2, 1)
  const half = (horizontal ? g.sourceHeight : g.sourceWidth) / 2
  const baseAngle = horizontal ? Math.PI / 2 : 0
  const axisX = Math.cos(baseAngle),
    axisY = Math.sin(baseAngle)
  const centerX = g.sourceX + g.sourceWidth / 2,
    centerY = g.sourceY + g.sourceHeight / 2
  const direction =
    (g.width / 2 - centerX) * Math.sin(baseAngle) -
      (g.height / 2 - centerY) * Math.cos(baseAngle) >=
    0
      ? 1
      : -1
  const lean = ring
    ? 0
    : clamp(
        ((g.touchX - centerX) * axisX + (g.touchY - centerY) * axisY) /
          Math.max(half, 1),
        -1,
        1,
      ) * 0.9
  const insetX = Math.min(24, g.width / 3)
  const insetY = Math.min(24, g.height / 3)
  return {
    pullX: clamp(g.touchX, insetX, g.width - insetX),
    pullY: clamp(g.touchY, insetY, g.height - insetY),
    scale,
    ring,
    amplitude: (ring ? 20 : 32) * scale,
    lensWidth: (ring ? 90 : 140) * scale,
    aberration: ring ? 0.35 : 0.75,
    lead: (ring ? 80 : 120) * scale,
    tail: (ring ? 180 : 280) * scale,
    rimWidth: Math.max(14 * scale, 2.5),
    rimSoftness: (ring ? 200 : 320) * scale,
    seam: Math.max(48 * scale, 4),
    frame(progress: number) {
      const time = progress * total
      const fly = time - anticipation
      const pre = anticipation > 0 ? smooth(0, anticipation, time) : 0
      const flight = clamp(fly / travel)
      const moved = bezier(flight, 0.2, 1, 0.3, 1)
      const settle = smooth(0, 0.45, moved)
      const x = centerX + axisX * lean * half * settle
      const y = centerY + axisY * lean * half * settle
      const tilt = baseAngle + direction * lean * 0.45 * settle
      const maximumSquash = ring ? 1 : 1.4
      const cosine = Math.cos(tilt),
        sine = Math.sin(tilt)
      let reach = 0
      for (const cx of [0, g.width])
        for (const cy of [0, g.height]) {
          const dx = cx - x,
            dy = cy - y
          reach = Math.max(
            reach,
            Math.hypot(
              (cosine * dx + sine * dy) * maximumSquash,
              -sine * dx + cosine * dy,
            ),
          )
        }
      const swell = (ring ? 13 : 20) * scale
      reach += swell * maximumSquash + 60 * scale
      const radius =
        fly < 0
          ? minRadius + (ring ? 32 : 50) * scale * (1 - pre)
          : mix(minRadius, reach + 96 * scale, moved)
      const fade = 1 - smooth(0.2, 0.55, flight)
      const lift = anticipation === 0 ? 0 : (ring ? 0.1 : 0.175)
      const rimSoftness = (ring ? 200 : 320) * scale
      return {
        time,
        x,
        y,
        tilt,
        radius,
        squash: mix(1, maximumSquash, smooth(0, 0.5, moved)),
        spine: ring ? 0 : Math.max(0, half - minRadius) * (1 - settle),
        swell: swell * smooth(0, 0.3, moved),
        energy: smooth(0, 0.05, flight) * fade,
        pull: timing.buildupDisplacement * pre * (1 - smooth(0, 0.22, fly)),
        glow:
          fly < 0 ? lift * pre : mix(lift, 1, smooth(0, 0.07, flight)) * fade,
        rim:
          (ring ? 0.7 : 0.85) *
          smooth(0, 0.1, flight) *
          (1 - smooth(0.9, 1, progress)),
        clear: mix(
          minRadius - rimSoftness,
          reach + rimSoftness,
          bezier((fly - linger) / rimFade, 0.45, 0, 0.55, 1),
        ),
        hairClear: mix(
          minRadius - rimSoftness,
          reach + rimSoftness,
          bezier((fly - linger - hairDelay) / 2.8, 0.45, 0, 0.55, 1),
        ),
        launched: fly > 0 ? 1 : 0,
        revealed:
          fly > 0 &&
          radius >=
            reach - 60 * scale + maximumSquash * Math.max(48 * scale, 4),
      }
    },
  }
}
