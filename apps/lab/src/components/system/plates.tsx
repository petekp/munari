// Site plates — the demo thumbnail, the stage caption, the ruler and the demo
// bar over system.css. A plate is a numbered image with its name and one
// line; the numbers follow the catalog's order.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classes, pointerAttrs, type PointerState } from './pointerState'

/** The system's one ornament: a 1px ink line with minor and major ticks. */
export function Ruler({ className }: { readonly className?: string }) {
  return <div className={classes('m-ruler', className)} />
}

interface PlateProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly image: string
  readonly number: string
  readonly title: string
  readonly headline: string
  /** The plate whose demo is on the stage. */
  readonly selected?: boolean
  readonly pointerState?: PointerState
}

export function Plate({ image, number, title, headline, selected = false, pointerState, className, ...rest }: PlateProps) {
  return (
    <button type="button" className={classes('m-plate', className)} aria-pressed={selected} {...pointerAttrs(pointerState)} {...rest}>
      <img className="m-plate-image" src={image} alt="" />
      <span className="m-plate-meta"><span className="m-plate-number m-readout">{number}</span><span className="m-plate-title">{title}</span></span>
      <span className="m-plate-headline">{headline}</span>
    </button>
  )
}

/** The line under a stage: the demo's name and what to try, then a link,
 * then the ruler that closes the stage. */
export function StageCaption({ title, action, children }: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  return (
    <>
      <div className="m-stage-caption"><p><b>{title}.</b> {children}</p>{action}</div>
      <Ruler />
    </>
  )
}

interface BarProps {
  /** Sits at the left, such as the wordmark linking home. */
  readonly lead?: ReactNode
  readonly title: ReactNode
  /** h1 where the bar names the page, as above a demo. */
  readonly titleTag?: 'h1' | 'b'
  readonly instruction?: ReactNode
  /** Sits at the right: the position, Previous, Next and Source. */
  readonly links: ReactNode
  readonly linksLabel?: string
  readonly className?: string
}

export function Bar({ lead, title, titleTag: Title = 'b', instruction, links, linksLabel = 'Demos', className }: BarProps) {
  return (
    <header className={classes('m-bar', className)}>
      {lead}
      <div className="m-bar-demo"><Title className="m-bar-title">{title}</Title>{instruction && <span>{instruction}</span>}</div>
      <nav className="m-bar-links" aria-label={linksLabel}>{links}</nav>
    </header>
  )
}
