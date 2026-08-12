// The left column: a colorful, abstract generative visualization, drawn
// directly from the live knob bag every frame.
//
// This is ordinary page DOM — no Surface, no idle-zero budget — so it is
// free to animate continuously. It follows the same doctrine as
// genieBounce.ts anyway: one rAF loop writing attributes straight onto
// pre-mounted elements, never a React re-render, because the knob bag can
// change sixty times a second under a dragged rotary and nothing here
// should schedule work for that.

import { useEffect, useRef } from 'react'
import { ART_MAX_LAYERS, artClock, generateArt, knobsValues, stepFade } from './knobsLaw'

export function KnobsArt() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const layerRefs = useRef<(SVGPolygonElement | null)[]>([])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastWrite = 0
    let t = 0
    let lastBackdrop = ''
    let lastBright = ''
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      if (knobsValues.power) t += dt
      // Publish the clock: the WebGL light rig reads this so the glints
      // in the metal orbit in the art's exact phase (and freeze with it
      // when the power switch drops).
      artClock.t = t

      // The picture's life: power off and it dies dark rather than
      // freezing bright — and because every light the scene owns scales
      // by this same number, the room dies with it. Only the lamps and
      // the phosphor readouts (DOM light, not scene light) survive.
      const target = knobsValues.power ? 1 : 0
      let lit = stepFade(artClock.lit, target, dt)
      if (Math.abs(lit - target) < 0.001) lit = target
      artClock.lit = lit
      // Never fully black: a dead screen still shows its glass.
      const bright = (0.03 + 0.97 * lit).toFixed(3)
      if (bright !== lastBright && rootRef.current) {
        lastBright = bright
        rootRef.current.style.filter = `brightness(${bright})`
      }

      // Dead and settled: the clock is stopped, so the picture cannot
      // have changed — regenerating it and rewriting every polygon
      // would only re-raster an unchanged SVG each frame. The loop
      // keeps breathing (it is the power switch's own wake-up), it
      // just stops paying for a picture nobody is drawing.
      if (!knobsValues.power && lit === 0) {
        raf = requestAnimationFrame(tick)
        return
      }

      // The picture drifts slowly, and each polygon write re-rasters a
      // viewport-sized SVG. Painting it at most ~80 times a second is
      // every other frame on a 120 Hz rail and every frame at 60 —
      // invisible either way, and it halves the raster bill exactly
      // where the frame budget is tightest.
      if (now - lastWrite < 12) {
        raf = requestAnimationFrame(tick)
        return
      }
      lastWrite = now

      const scene = generateArt(knobsValues, t)

      scene.layers.forEach((layer, i) => {
        const el = layerRefs.current[i]
        if (!el) return
        el.setAttribute('points', layer.points)
        el.setAttribute('fill', layer.fill)
        el.setAttribute('stroke', layer.stroke)
        el.setAttribute('opacity', String(layer.opacity))
        el.style.display = ''
      })
      for (let i = scene.layers.length; i < ART_MAX_LAYERS; i++) {
        const el = layerRefs.current[i]
        if (el) el.style.display = 'none'
      }
      // The backdrop lives on the container as CSS, so it fills the whole
      // viewport while the SVG letterboxes the art. Written only when the
      // colors actually change — a steady hue costs no style work.
      const backdrop = `linear-gradient(165deg, ${scene.backdropFrom}, ${scene.backdropTo})`
      if (backdrop !== lastBackdrop && rootRef.current) {
        lastBackdrop = backdrop
        rootRef.current.style.background = backdrop
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="knb-art" ref={rootRef}>
      <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden>
        {Array.from({ length: ART_MAX_LAYERS }).map((_, i) => (
          <polygon
            key={i}
            ref={(el) => {
              layerRefs.current[i] = el
            }}
            points=""
            strokeWidth={0.6}
          />
        ))}
      </svg>
    </div>
  )
}
