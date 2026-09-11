// Home preparation — fonts, then the current rendered composition, then reveal.
// A stalled graphics setup falls back once to stable native content; it cannot
// attach lighting later over a page the visitor is already using.
import {useCallback, useEffect, useState} from 'react'
import {announceHomeReady} from '../../components/siteOpening'

// Decision #57: a failure limit; a valid frame releases immediately.
const GRAPHICS_DEADLINE_MS = 4000
type Phase = 'fonts' | 'graphics' | 'enhanced' | 'native'

export function useHomeOpening(onReady: () => void = announceHomeReady) {
  const [phase, setPhase] = useState<Phase>('fonts')
  useEffect(() => {
    let alive = true
    void document.fonts.ready.then(() => { if (alive) setPhase('graphics') })
    return () => { alive = false }
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
  return {effectsEnabled: phase === 'graphics' || phase === 'enhanced', native: phase === 'native', ready: phase === 'native' || phase === 'enhanced', onReady: reportReady}
}
