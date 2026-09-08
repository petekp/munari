// Light drag — one captured pointer moves the bulb and preserves native selection.
// Release and cancellation restore the page's previous selection behavior.
// The masthead owns the position and frame; this hook owns the gesture (#50).
import { useEffect, type RefObject } from 'react'
import { BULB_RADIUS } from './homeLightBulb'
import type { Point } from './homeLightLaw'

interface Options {
  fixture: RefObject<HTMLButtonElement | null>
  dragging: RefObject<boolean>
  anchor: RefObject<Point>
  driftEpoch: RefObject<number>
  reducedMotion: RefObject<boolean>
  currentLight: () => Point
  redraw: () => void
  setDragged: (dragged: boolean) => void
}

export function useHomeLightDrag({ fixture, dragging, anchor, driftEpoch, reducedMotion, currentLight, redraw, setDragged }: Options) {
  useEffect(() => {
    const element = fixture.current
    if (!element) return
    let pointer: number | null = null
    let grip: Point = { x: 0, y: 0 }
    let previousUserSelect = ''
    const move = (event: PointerEvent) => {
      if (event.pointerId!==pointer) return
      const margin = BULB_RADIUS+8
      anchor.current = {
        x: Math.max(margin,Math.min(window.innerWidth-margin,event.clientX-grip.x)),
        y: Math.max(margin,Math.min(window.innerHeight-margin,event.clientY-grip.y)),
      }
      if (reducedMotion.current) redraw()
    }
    const down = (event: PointerEvent) => {
      if (event.button!==0 || pointer!==null) return
      event.preventDefault()
      const light = currentLight()
      grip = { x: event.clientX-light.x, y: event.clientY-light.y }
      pointer = event.pointerId
      dragging.current = true
      previousUserSelect = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      element.setPointerCapture(pointer)
      element.classList.add('is-dragging')
      setDragged(true)
      move(event)
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId!==pointer) return
      pointer = null
      dragging.current = false
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
      element.classList.remove('is-dragging')
      document.body.style.userSelect = previousUserSelect
      driftEpoch.current = performance.now()
    }
    element.addEventListener('pointerdown',down)
    element.addEventListener('pointermove',move)
    element.addEventListener('pointerup',up)
    element.addEventListener('pointercancel',up)
    element.addEventListener('lostpointercapture',up)
    return () => {
      element.removeEventListener('pointerdown',down)
      element.removeEventListener('pointermove',move)
      element.removeEventListener('pointerup',up)
      element.removeEventListener('pointercancel',up)
      element.removeEventListener('lostpointercapture',up)
      if (pointer!==null) document.body.style.userSelect = previousUserSelect
      dragging.current = false
    }
  }, [fixture,dragging,anchor,driftEpoch,reducedMotion,currentLight,redraw,setDragged])
}
