// Lit page preparation — fonts, then the current rendered composition, then reveal.
// A stalled graphics setup falls back once to stable native content; it cannot
// attach lighting later over a page the visitor is already using.
import {useCallback, useEffect, useState} from 'react'

// Decision #57: a failure limit; a valid frame releases immediately. Counted
// in the enclosing <Loading>'s frame time, so a hidden page adds none.
const GRAPHICS_DEADLINE_MS = 4000
type Phase = 'fonts' | 'graphics' | 'enhanced' | 'native'

/**
 * The page's opening. Render `late` on a <Loading> around the page, and
 * <LoadingPending> inside it until `ready`.
 */
export function useLightOpening() {
  const [phase, setPhase] = useState<Phase>('fonts')
  useEffect(() => {
    let alive = true
    void document.fonts.ready.then(() => { if (alive) setPhase(current => current === 'fonts' ? 'graphics' : current) })
    return () => { alive = false }
  }, [])
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    // Enhanced readiness already follows a completed draw and layout recheck;
    // changing graphics -> enhanced does not change the rendered children.
    if (phase === 'enhanced') { setSettled(true); return }
    if (phase !== 'native') return
    // Native fallback first commits its final controls and removes the canvases.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setSettled(true)) })
    return () => cancelAnimationFrame(frame)
  }, [phase])
  const reportReady = useCallback((mode: 'enhanced' | 'native') => {
    setPhase(current => current === 'graphics' ? mode : current)
  }, [])
  const [late] = useState(() => ({afterMs: GRAPHICS_DEADLINE_MS, onLate: () => setPhase(current => current === 'enhanced' ? current : 'native')}))
  return {effectsEnabled: phase === 'graphics' || phase === 'enhanced', native: phase === 'native', ready: phase === 'native' || phase === 'enhanced', settled, onReady: reportReady, late}
}
