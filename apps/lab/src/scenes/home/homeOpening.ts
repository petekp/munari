// Home preparation — fonts, then the current rendered composition, then reveal.
// Every wait exits to stable native content: fonts that never settle, a
// stalled graphics setup, and a thrown one. Native content cannot attach
// lighting later over a page the visitor is already using.
//
// Fault: WebKit's ResizeObserver throws on `device-pixel-content-box`, and the
// deployed lighting setup called it unguarded. The throw unmounted Home with
// its deadline, so the cover never lifted on any iOS browser (2026-09-25,
// decision #69).
import {useCallback, useEffect, useState} from 'react'
import {announceHomeReady} from '../../components/siteOpening'

// Decision #57: a failure limit; a valid frame releases immediately.
const GRAPHICS_DEADLINE_MS = 4000
// Decision #69: one stalled font request otherwise holds the cover indefinitely,
// because `document.fonts.ready` has no deadline of its own.
const FONTS_DEADLINE_MS = GRAPHICS_DEADLINE_MS
type Phase = 'fonts' | 'graphics' | 'enhanced' | 'native'

export function useHomeOpening(onReady: () => void = announceHomeReady) {
  const [phase, setPhase] = useState<Phase>('fonts')
  useEffect(() => {
    let alive = true
    void document.fonts.ready.then(() => { if (alive) setPhase(current => current === 'fonts' ? 'graphics' : current) })
    const timer = window.setTimeout(() => setPhase(current => current === 'fonts' ? 'native' : current), FONTS_DEADLINE_MS)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [])
  useEffect(() => {
    if (phase !== 'graphics') return
    const timer = window.setTimeout(() => setPhase(current => current === 'graphics' ? 'native' : current), GRAPHICS_DEADLINE_MS)
    return () => window.clearTimeout(timer)
  }, [phase])
  useEffect(() => {
    // Enhanced readiness already follows a completed draw and layout recheck;
    // changing graphics -> enhanced does not change the rendered children.
    if (phase === 'enhanced') { onReady(); return }
    if (phase !== 'native') return
    // Native fallback first commits its final controls and removes the canvases.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(onReady) })
    return () => cancelAnimationFrame(frame)
  }, [phase, onReady])
  const reportReady = useCallback((mode: 'enhanced' | 'native') => {
    setPhase(current => current === 'graphics' ? mode : current)
  }, [])
  // A thrown graphics setup is a failed preparation, like a stalled one (#69).
  const fail = useCallback(() => { setPhase('native') }, [])
  return {effectsEnabled: phase === 'graphics' || phase === 'enhanced', native: phase === 'native', ready: phase === 'native' || phase === 'enhanced', onReady: reportReady, fail}
}
