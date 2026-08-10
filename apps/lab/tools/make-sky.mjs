// make-sky — the source of apps/lab/public/sky.mp4
//
// The lab needs a window whose content is DECODED VIDEO rather than
// markup, because that is the strongest claim this scene can make: the
// texture is a live replay of the page's paint records, and video frames
// are the one kind of content you would expect that replay to miss.
// (They do arrive — measured 2026-08-09, Chrome 150: a clip that flips
// magenta at 1s reads magenta before and yellow after, straight out of
// drawElementImage. A poster frame or a first-frame snapshot would read
// magenta twice.)
//
// The clip is GENERATED, not sourced. A stock file would be a binary in
// the tree with no provenance, no licence story, and no way to change
// its size, palette, or length without finding another one. This script
// is the file's source: same seed, same frames, byte-comparable output.
//
// Two things make the result loop without a seam, and both are the same
// idea — every moving thing is periodic in T:
//
//   * position is a phase, not an accumulation. Each drifting thing gets
//     `p = (p0 + k * t/T) mod 1` for INTEGER k, so at t = T every p is
//     back where it started. Nothing is integrated frame to frame, so
//     nothing can drift out of period.
//   * the wingbeat is likewise an integer number of cycles over T.
//
// A seam here would be brutal: the window loops forever on a desk that
// invites you to stare at it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const here = path.dirname(fileURLToPath(import.meta.url))
// Beside the scene that imports it, not in public/ — an import is
// resolved and hashed by the bundler, so a deploy under a base path
// still finds it and a missing file fails the build instead of 404ing
// in front of whoever opened the demo.
const OUT = path.join(here, '..', 'src', 'scenes', 'sky.mp4')
const WORK = path.join(here, '..', '..', '..', 'node_modules', '.cache', 'munari-sky')

// The window's body box is 300x198 CSS px; render at 2x so the clip is
// still sharp on a retina desk, and let the genie minify from there.
const W = 600
const H = 396
const FPS = 24
const PERIOD = 12 // seconds — must equal SKY_PERIOD in Genie.tsx
const FRAMES = FPS * PERIOD

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))
if (!CHROME) throw new Error('make-sky: no Chrome found; set CHROME_PATH')

// ── the frame ───────────────────────────────────────────────────────────
//
// Runs inside the page. Deterministic in t alone: no wall clock, no
// unseeded randomness, no state carried between calls — so frame 137 is
// the same image whether it is rendered first or last.
const PAGE = `<!doctype html><meta charset=utf-8>
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id=c width=${W} height=${H}></canvas>
<script>
const W = ${W}, H = ${H}, T = ${PERIOD}
const c = document.getElementById('c'), g = c.getContext('2d')

// mulberry32 — small, fast, and identical everywhere, which is the only
// property that matters here.
const rng = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const lerp = (a, b, u) => a + (b - a) * u
const wrap = (p0, k, t) => (p0 + k * (t / T)) % 1

// Dusk, warm at the horizon and cool overhead. Kept adjacent to the
// lab's paper palette — sand and slate rather than a postcard blue —
// so the window reads as part of this desk and not a stock plate
// dropped onto it.
const SKY = [
  [0.00, '#2e3846'], [0.30, '#59606f'], [0.55, '#95878a'],
  [0.76, '#caa480'], [1.00, '#f2ddb0'],
]

const R = rng(20260809)
// Cloud bands: wide, soft, almost flat. Blur does the work; the shapes
// underneath are plain ellipses.
const CLOUDS = Array.from({ length: 10 }, () => ({
  y: lerp(0.28, 0.95, R()),
  rx: lerp(0.20, 0.58, R()) * W,
  ry: lerp(6, 30, R()),
  a: lerp(0.10, 0.30, R()),
  p0: R(),
  k: 1 + Math.floor(R() * 2),
  warm: R(),
}))

// Flocks. Depth drives everything at once — size, speed, how dark the
// silhouette is against the haze — because that is what depth does.
const FLOCKS = Array.from({ length: 11 }, () => {
  // Biased toward the near end: a sky of specks reads as dust, and the
  // window has to survive being looked at from a foot away.
  const d = Math.pow(R(), 0.62)
  const n = 3 + Math.floor(R() * 7)
  return {
    d, n,
    s: lerp(3.4, 15, d),
    a: lerp(0.26, 0.82, d),
    // Birds live in the upper air here; the bottom third is the sun's,
    // and a silhouette down there fights the glow instead of sitting in
    // front of it.
    y: lerp(0.08, 0.66, R()),
    bob: lerp(4, 16, d),
    bobK: 1 + Math.floor(R() * 2),
    p0: R(),
    k: 1 + Math.floor(R() * 2) + (d > 0.6 ? 1 : 0),
    dir: R() < 0.78 ? 1 : -1,
    // Small birds beat faster. Integer cycles over T, so the wings are
    // in the same place at the loop point as at the start.
    flap: Math.round(lerp(19, 9, d)),
    jitter: Array.from({ length: 9 }, () => [R() - 0.5, R() - 0.5, R()]),
  }
})

// One bird: two strokes from a shared shoulder, the control points
// rising and falling together. No body — at 10px a body is a smudge,
// and the eye reads the silhouette from the wings alone.
function bird(x, y, s, phase, alpha) {
  const f = Math.sin(phase)
  const up = s * (0.14 + 0.62 * f)
  const droop = s * 0.1 * (1 - f)
  g.globalAlpha = alpha
  g.lineWidth = Math.max(0.7, s * 0.15)
  g.beginPath()
  g.moveTo(x - s, y - droop)
  g.quadraticCurveTo(x - s * 0.45, y - up, x, y)
  g.quadraticCurveTo(x + s * 0.45, y - up, x + s, y - droop)
  g.stroke()
}

// Static film grain, generated once. Static on purpose: grain that
// re-rolls every frame would sparkle, and would also be the one thing
// in the clip that does not return to itself at the loop point.
//
// Its real job is dither. A five-stop vertical gradient is exactly the
// image x264 bands worst, and a per-pixel ±1 rattle breaks the flat
// regions the quantiser would otherwise round into stripes. So it is
// pitched to be arithmetically present and visually absent: alpha 0..9
// is under half a code value at 8-bit, where the first pass ran 0..26
// and read as dirt on the lens.
const GRAIN = (() => {
  const o = new OffscreenCanvas(W, H)
  const ctx = o.getContext('2d')
  const im = ctx.createImageData(W, H)
  const g2 = rng(77003)
  for (let i = 0; i < im.data.length; i += 4) {
    const v = g2()
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v < 0.5 ? 0 : 255
    im.data[i + 3] = Math.floor(g2() * 9)
  }
  ctx.putImageData(im, 0, 0)
  return o
})()

window.renderFrame = (t) => {
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
  g.filter = 'none'

  const sky = g.createLinearGradient(0, 0, 0, H)
  for (const [at, col] of SKY) sky.addColorStop(at, col)
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)

  // The low sun, off to one side and never drawn as a disc — just the
  // warmth it puts into the air near the horizon.
  const glow = g.createRadialGradient(W * 0.72, H * 1.02, 0, W * 0.72, H * 1.02, H * 0.78)
  glow.addColorStop(0, 'rgba(255,214,150,0.55)')
  glow.addColorStop(0.5, 'rgba(255,190,138,0.16)')
  glow.addColorStop(1, 'rgba(255,190,138,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, W, H)

  g.save()
  g.filter = 'blur(14px)'
  for (const cl of CLOUDS) {
    const L = W + cl.rx * 2
    const x = wrap(cl.p0, cl.k, t) * L - cl.rx
    g.globalAlpha = cl.a
    g.fillStyle = cl.warm > 0.45 ? '#ffe6bd' : '#c9c9d2'
    g.beginPath()
    g.ellipse(x, cl.y * H, cl.rx, cl.ry, 0, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()

  g.strokeStyle = '#14140f'
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const fl of FLOCKS) {
    const L = W + 260
    const px = wrap(fl.p0, fl.k, t) * L - 130
    const lx = fl.dir > 0 ? px : W - px
    const ly = fl.y * H + Math.sin((t / T) * fl.bobK * Math.PI * 2) * fl.bob
    for (let i = 0; i < fl.n; i++) {
      // A V: the leader, then alternating arms falling back and down.
      const arm = i === 0 ? 0 : i % 2 === 0 ? 1 : -1
      const rank = Math.ceil(i / 2)
      const [jx, jy, jp] = fl.jitter[i]
      const bx = lx - fl.dir * rank * fl.s * (2.5 + jx * 0.5)
      const by = ly + arm * rank * fl.s * (1.15 + jy * 0.3)
      // Each bird carries its own offset into the beat. Synchronised
      // wings read as one object; offset wings read as a flock.
      bird(bx, by, fl.s, (t / T) * fl.flap * Math.PI * 2 + jp * Math.PI * 2, fl.a)
    }
  }

  g.globalAlpha = 1
  g.drawImage(GRAIN, 0, 0)

  const vig = g.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, H * 0.95)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(20,20,15,0.16)')
  g.fillStyle = vig
  g.fillRect(0, 0, W, H)

  return c.toDataURL('image/png')
}
</script>`

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.setContent(PAGE, { waitUntil: 'load' })

  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  process.stdout.write(`  rendering ${FRAMES} frames at ${W}x${H} `)
  for (let i = 0; i < FRAMES; i++) {
    const url = await page.evaluate((t) => window.renderFrame(t), (i / FPS) % PERIOD)
    writeFileSync(path.join(WORK, `f${String(i).padStart(4, '0')}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    if (i % 48 === 0) process.stdout.write('.')
  }
  console.log(' done')

  mkdirSync(path.dirname(OUT), { recursive: true })
  execFileSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-framerate', String(FPS),
      '-i', path.join(WORK, 'f%04d.png'),
      '-an',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-crf', '25',
      // A keyframe every second. The window seeks on mount to line the
      // airborne copy up with the page copy, and a seek lands on the
      // nearest keyframe — sparse ones would make the two copies visibly
      // disagree at the swap.
      '-g', String(FPS),
      '-movflags', '+faststart',
      OUT,
    ],
    { stdio: 'inherit' },
  )
  rmSync(WORK, { recursive: true, force: true })
  const kb = (execFileSync('stat', ['-f%z', OUT]).toString().trim() / 1024).toFixed(0)
  console.log(`\n  wrote ${path.relative(process.cwd(), OUT)} — ${kb} KB, ${PERIOD}s, ${FPS}fps, ${W}x${H}`)
} finally {
  await browser.close()
}
