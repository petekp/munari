// Site actions — the button, the text button and the copy block over
// system.css. A button switches state instantly; only the copy block holds
// a state of its own, the confirmation, for COPIED_MS.

import { useEffect, useState, type ButtonHTMLAttributes } from 'react'
import { classes, pointerAttrs, type PointerState } from './pointerState'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Solid is the one primary action in a view; outline is everything else. */
  readonly variant?: 'solid' | 'outline'
  /** Compact buttons are 32px, for desktop panels. */
  readonly compact?: boolean
  readonly pointerState?: PointerState
}

export function Button({ variant = 'solid', compact = false, pointerState, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={classes('m-button', variant === 'outline' && 'm-button--outline', compact && 'm-button--compact', className)}
      {...pointerAttrs(pointerState)}
      {...rest}
    />
  )
}

interface TextButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly pointerState?: PointerState
}

export function TextButton({ pointerState, className, type = 'button', ...rest }: TextButtonProps) {
  return <button type={type} className={classes('m-textbutton', className)} {...pointerAttrs(pointerState)} {...rest} />
}

// Long enough to read "Copied" after the click, short enough that a second
// copy finds the button reset.
const COPIED_MS = 1600

export function CopyBlock({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div className="m-copy">
      <code>{text}</code>
      <TextButton onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)) }}>{copied ? 'Copied' : 'Copy'}</TextButton>
    </div>
  )
}
