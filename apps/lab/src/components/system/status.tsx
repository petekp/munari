// Site status — the status word, the tag and the notice over system.css.
// The words carry the meaning: a status square only repeats its word, and a
// notice names itself in bold before it explains.

import type { ReactNode } from 'react'

/** live: HTML-in-canvas. fallback: snapDOM. idle: nothing to draw yet.
 * unavailable: no capture path. */
export type CaptureStatus = 'live' | 'fallback' | 'idle' | 'unavailable'

export function Status({ status, children }: { readonly status: CaptureStatus; readonly children: ReactNode }) {
  return <span className="m-status" data-status={status}>{children}</span>
}

/** A fact about the page, not a control. */
export function Tag({ children }: { readonly children: ReactNode }) {
  return <span className="m-tag">{children}</span>
}

interface NoticeProps {
  /** A short bold lead, such as "Needs Chrome." or "Error:". */
  readonly title: string
  /** An error interrupts and draws a heavier rule; a status waits. */
  readonly kind?: 'status' | 'error'
  /** Sits at the right, such as a Dismiss text button. */
  readonly action?: ReactNode
  readonly children: ReactNode
}

export function Notice({ title, kind = 'status', action, children }: NoticeProps) {
  return (
    <div className="m-notice" role={kind === 'error' ? 'alert' : 'status'}>
      <b>{title}</b>
      <p>{children}</p>
      {action}
    </div>
  )
}
