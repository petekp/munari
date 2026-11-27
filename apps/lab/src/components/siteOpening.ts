// Site opening — one reveal after the first page has drawn its composition.
// The native cover precedes the app bundle and stays outside the captured
// content. A page in the top window reveals the site itself; a framed demo
// marks its document ready and tells the page that frames it, which reveals
// the frame then. The frame's load event came 0.4-0.6 s in, while scenes
// were still building for 1.6-3.3 s (docs/loading/measurements.md).
import { useEffect, useEffectEvent, type RefObject } from 'react'

const PAGE_READY_MESSAGE = 'munari-lab:page-ready'

export function revealSite() {
  const root = document.documentElement
  const cover = document.getElementById('site-opening')
  if (!cover || !root.hasAttribute('data-opening') || root.dataset.opening === 'revealing') return
  const finish = () => { cover.remove(); delete root.dataset.opening }
  document.getElementById('root')?.removeAttribute('inert')
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return }
  cover.addEventListener('transitionend', finish, {once: true})
  cover.addEventListener('transitioncancel', finish, {once: true})
  root.dataset.opening = 'revealing'
}

export function announcePageReady() {
  document.documentElement.dataset.pageReady = 'true'
  if (window.parent === window) revealSite()
  else window.parent.postMessage(PAGE_READY_MESSAGE, location.origin)
}

/** Run `ready` each time the page in `frame` announces it is ready. */
export function useFramePageReady(frame: RefObject<HTMLIFrameElement | null>, ready: () => void) {
  const onReady = useEffectEvent(ready)
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const fromFrame = event.origin === location.origin && event.data === PAGE_READY_MESSAGE && event.source === frame.current?.contentWindow
      if (fromFrame) onReady()
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [frame])
}
