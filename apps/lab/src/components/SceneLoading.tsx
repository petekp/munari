// Scene loading — when the site reveals a scene and the demo frame that
// holds it.
//
// The law: a scene is revealed once everything in it has loaded, or at the
// late notice on its page presentation, and lifts to the scene when that is
// ready (docs/loading/decisions.md D3).
//
// Ownership: <Loading> reports; siteOpening.ts reveals.

import { useRef, type ReactNode } from 'react'
import { Loading } from '@petepetrash/munari'
import { announcePageReady, revealSite, useFramePageReady } from './siteOpening'

// A scene that is still loading this long is revealed on its page
// presentation, and lifts to the scene when that is ready (docs/loading/
// decisions.md D3). The same limit as Light's graphics (decision #57).
const REVEAL_LATE_MS = 4000

/** Reveal the scene once everything in it has loaded, or at the late notice. */
export function SceneLoading({ children }: { readonly children: ReactNode }) {
  return (
    <Loading onLoaded={announcePageReady} late={{ afterMs: REVEAL_LATE_MS, onLate: announcePageReady }}>
      {children}
    </Loading>
  )
}

/** The shell's frame of the current demo, revealed when the demo says it is ready. */
export function DemoFrame({ src, title }: { readonly src: string; readonly title: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useFramePageReady(frame, revealSite)
  return <iframe ref={frame} src={src} title={title} className="site-frame" />
}
