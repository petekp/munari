// Site panels — the tuning panel and a demo's window chrome over system.css.
// A panel is a column of disclosure sections between a head and a foot; a
// window is a title bar over a body, inverted while focused. Neither casts
// a shadow: they separate by their edge and the ground behind them.

import type { HTMLAttributes, ReactNode } from 'react'
import { CHEVRON } from './fields'
import { classes } from './pointerState'

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly title: ReactNode
  /** Sits at the right of the head, such as a Hide button. */
  readonly action?: ReactNode
  /** Buttons under the sections, such as Copy values and Reset. */
  readonly foot?: ReactNode
}

export function Panel({ title, action, foot, className, children, ...rest }: PanelProps) {
  return (
    <div className={classes('m-panel', className)} {...rest}>
      <div className="m-panel-head"><b>{title}</b>{action}</div>
      {children}
      {foot && <div className="m-panel-foot">{foot}</div>}
    </div>
  )
}

interface PanelSectionProps {
  readonly title: string
  readonly defaultOpen?: boolean
  readonly children: ReactNode
}

export function PanelSection({ title, defaultOpen = false, children }: PanelSectionProps) {
  return (
    <details open={defaultOpen}>
      <summary>{title}{CHEVRON}</summary>
      <div className="m-panel-group">{children}</div>
    </details>
  )
}

interface WindowProps {
  readonly title: string
  readonly focused?: boolean
  readonly onClose?: () => void
  readonly className?: string
  readonly bodyClassName?: string
  readonly children: ReactNode
}

export function Window({ title, focused = false, onClose, className, bodyClassName, children }: WindowProps) {
  return (
    <div className={classes('m-window', className)} data-focused={focused || undefined}>
      <div className="m-window-bar"><button type="button" className="m-window-close" aria-label={`Close ${title}`} onClick={onClose} />{title}</div>
      <div className={classes('m-window-body', bodyClassName)}>{children}</div>
    </div>
  )
}
