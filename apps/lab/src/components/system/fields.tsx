// Site fields — a labeled text input, textarea or select over system.css.
// Field owns the wiring: the label names the control by id, and a message
// is linked through aria-describedby, so an error is read with the field
// it belongs to rather than only shown beside it.

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { classes, pointerAttrs, type PointerState } from './pointerState'

export interface FieldControlProps {
  readonly id: string
  readonly 'aria-describedby': string | undefined
  readonly 'aria-invalid': true | undefined
}

interface FieldProps {
  readonly label: string
  /** Help or an error under the control. */
  readonly message?: ReactNode
  /** Marks the control invalid; the message should then say why. */
  readonly invalid?: boolean
  readonly className?: string
  readonly children: (control: FieldControlProps) => ReactNode
}

export function Field({ label, message, invalid = false, className, children }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  return (
    <div className={classes('m-field', className)}>
      <label className="m-field-label" htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': message ? messageId : undefined, 'aria-invalid': invalid || undefined })}
      {message && <span id={messageId} className="m-field-message">{message}</span>}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly pointerState?: PointerState
}

export function Input({ pointerState, className, ...rest }: InputProps) {
  return <input className={classes('m-input', className)} {...pointerAttrs(pointerState)} {...rest} />
}

/** A number with its unit printed inside the field's right edge. */
export function UnitInput({ unit, className, ...rest }: InputProps & { readonly unit: string }) {
  return (
    <span className="m-field-unit">
      <Input className={classes('m-readout', className)} inputMode="decimal" {...rest} />
      <span className="m-readout" aria-hidden>{unit}</span>
    </span>
  )
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={classes('m-input', className)} {...rest} />
}

export const CHEVRON = <svg viewBox="0 0 16 16" aria-hidden><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly options: readonly (readonly [value: string, label: string])[]
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <span className="m-select">
      <select className={classes('m-input', className)} {...rest}>
        {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {CHEVRON}
    </span>
  )
}
