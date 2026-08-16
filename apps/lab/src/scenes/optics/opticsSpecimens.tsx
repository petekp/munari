// The specimens on the proofing sheet.
//
// Each is chosen for what it does to a raster. The Aqua sheet carries
// 2px pinstripes, which is the finest repeating structure a display can
// hold; the LCD carries a 3px cell grid; the type block carries a 5.5pt
// setting and rules a quarter of a pixel wide. Magnify any of them from a
// screenshot and the structure averages into grey. Magnify them from the
// document and the structure is still there, because the raster is being
// replayed rather than stretched.
//
// The calculator is the one that argues the other half. It is real DOM
// with real state, and it keeps working with 1.65× of refraction between
// the finger and the key — which is only true because the pointer is
// refracted by the same six lines the shader uses on the view ray.

import { useEffect, useState } from 'react'

export function AquaSheet() {
  return (
    <div className="opt-aqua">
      <div className="opt-aqua-body">
        <div className="opt-aqua-caution" />
        <div>
          <h3>Do you want to save the changes you made to “Proof 3”?</h3>
          <p>Your changes will be lost if you don’t save them.</p>
        </div>
      </div>
      <div className="opt-aqua-row">
        <button className="opt-aqua-btn" type="button">
          Don’t Save
        </button>
        <button className="opt-aqua-btn" type="button">
          Cancel
        </button>
        <button className="opt-aqua-btn" type="button" data-default="">
          Save
        </button>
      </div>
    </div>
  )
}

/**
 * The one specimen that is never quiescent: the colon blinks at 1 Hz, so
 * the block repaints once a second forever. That is deliberate — the
 * paint scope has to be able to tell a live block from a still one, and a
 * sheet where everything is still would not prove it can.
 */
export function LcdPanel() {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const now = new Date(tick)
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const colon = now.getSeconds() % 2 ? ' ' : ':'
  const day = now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })

  return (
    <div className="opt-lcd">
      <div className="opt-lcd-bar">
        <div className="opt-lcd-signal">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span>munari</span>
        <span>▮▮▯</span>
      </div>
      <div className="opt-lcd-clock">
        {hh}
        {colon}
        {mm}
      </div>
      <div className="opt-lcd-date">{day}</div>
      <div className="opt-lcd-menu">
        <span>Menu</span>
        <span>Names</span>
      </div>
    </div>
  )
}

export function LunaBar() {
  return (
    <div className="opt-luna">
      <button className="opt-luna-start" type="button">
        <span className="opt-luna-flag">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="opt-luna-word">start</span>
      </button>
      <div className="opt-luna-tasks">
        <div className="opt-luna-task">Proof sheet</div>
        <div className="opt-luna-task">Ledger.xls</div>
      </div>
      <div className="opt-luna-tray">4:16 PM</div>
    </div>
  )
}

// ── the calculator ─────────────────────────────────────────────────────

type Op = '+' | '−' | '×' | '÷'

const APPLY = {
  '+': (a: number, b: number) => a + b,
  '−': (a: number, b: number) => a - b,
  '×': (a: number, b: number) => a * b,
  '÷': (a: number, b: number) => (b === 0 ? NaN : a / b),
} satisfies Record<Op, (a: number, b: number) => number>

interface KeyCap {
  label: string
  kind?: 'op' | 'eq' | 'clear'
}

const KEYS: KeyCap[] = [
  { label: 'C', kind: 'clear' },
  { label: '±', kind: 'op' },
  { label: '%', kind: 'op' },
  { label: '÷', kind: 'op' },
  { label: '7' },
  { label: '8' },
  { label: '9' },
  { label: '×', kind: 'op' },
  { label: '4' },
  { label: '5' },
  { label: '6' },
  { label: '−', kind: 'op' },
  { label: '1' },
  { label: '2' },
  { label: '3' },
  { label: '+', kind: 'op' },
  { label: '0' },
  { label: '.' },
  { label: '⌫', kind: 'op' },
  { label: '=', kind: 'eq' },
]

/** Nine significant figures, no exponent — a pocket calculator's window. */
function show(n: number): string {
  if (!Number.isFinite(n)) return 'error'
  const s = String(Number(n.toPrecision(9)))
  return s.length > 11 ? n.toExponential(4) : s
}

export function Calculator() {
  const [entry, setEntry] = useState('0')
  const [held, setHeld] = useState<number | null>(null)
  const [op, setOp] = useState<Op | null>(null)
  // True while the display shows a RESULT rather than something typed —
  // the next digit replaces it instead of appending to it.
  const [settled, setSettled] = useState(true)

  const press = (label: string) => {
    if (/[0-9]/.test(label)) {
      setEntry(settled || entry === '0' ? label : entry + label)
      setSettled(false)
      return
    }
    switch (label) {
      case '.':
        if (settled) setEntry('0.')
        else if (!entry.includes('.')) setEntry(entry + '.')
        setSettled(false)
        return
      case 'C':
        setEntry('0')
        setHeld(null)
        setOp(null)
        setSettled(true)
        return
      case '⌫':
        setEntry(settled || entry.length <= 1 ? '0' : entry.slice(0, -1))
        setSettled(false)
        return
      case '±':
        setEntry(entry.startsWith('-') ? entry.slice(1) : `-${entry}`)
        return
      case '%':
        setEntry(show(Number(entry) / 100))
        setSettled(true)
        return
      case '=': {
        if (op === null || held === null) return
        setEntry(show(APPLY[op](held, Number(entry))))
        setHeld(null)
        setOp(null)
        setSettled(true)
        return
      }
      default: {
        // SAFETY: the switch above has taken every non-operator cap, so the
        // default arm is reached only by the four in APPLY.
        const next = label as Op
        // Chaining: a pending operator resolves before the new one is
        // taken, so 2 + 3 × 4 reads left to right like the hardware does.
        const value = op !== null && held !== null && !settled
          ? APPLY[op](held, Number(entry))
          : Number(entry)
        setEntry(show(value))
        setHeld(value)
        setOp(next)
        setSettled(true)
      }
    }
  }

  return (
    <div className="opt-calc">
      <div className="opt-calc-brand">
        <span>calc</span>
        <span>et</span>
      </div>
      <div className="opt-calc-screen">{entry}</div>
      <div className="opt-calc-keys">
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            className="opt-calc-key"
            data-kind={k.kind}
            onClick={() => press(k.label)}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── type and fine print ────────────────────────────────────────────────

const CUTS = [
  { size: '8', label: '8 pt' },
  { size: '6', label: '6.5 pt' },
  { size: '5', label: '5.5 pt' },
] as const

const COPY =
  'A raster is a decision about how much of a shape to keep. Replay the shape and the decision is made again.'

export function TypeSpecimen() {
  return (
    <div className="opt-type">
      <div className="opt-type-kicker">specimen</div>
      <h3>Sizes below reading</h3>
      {CUTS.map((c) => (
        <div className="opt-type-cut" key={c.size} data-size={c.size}>
          <b>{c.label}</b>
          <p>{COPY}</p>
        </div>
      ))}
      <div className="opt-type-rules">
        {(['1', '0.75', '0.5', '0.25'] as const).map((w) => (
          <div className="opt-type-rule" key={w} data-w={w}>
            <span>{w}px</span>
            <i />
          </div>
        ))}
      </div>
    </div>
  )
}

const ROWS: Array<[string, string, string]> = [
  ['Raster, 1×', '660 × 450', '1,188,000'],
  ['Raster, 2×', '1320 × 900', '4,752,000'],
  ['Raster, 3×', '1980 × 1350', '10,692,000'],
  ['Gradient energy, 1×', 'stripes', '60.7'],
  ['Gradient energy, 3×', 'stripes', '180.0'],
  ['Gradient energy, 1×', 'body text', '471.0'],
  ['Gradient energy, 3×', 'body text', '1,574.7'],
  ['Total variation, 1×', 'control', '5.49'],
  ['Total variation, 3×', 'control', '5.45'],
  ['Pointer error, mean', 'rim', '0.37 px'],
  ['Pointer error, control', 'flat page', '0.79 px'],
  ['Paints per lens sweep', '120 frames', '0'],
]

export function Ledger() {
  return (
    <div className="opt-ledger">
      <h3>Measured on this bench</h3>
      <p className="opt-ledger-sub">Chrome 150 · dpr 1 · CanvasDrawElement</p>
      <table>
        <thead>
          <tr>
            <th>Quantity</th>
            <th>Band</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r[0] + r[1]}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="opt-ledger-note">
        Gradient energy is the sharpness signal; total variation is the control, and it is supposed
        to read 1.00× — blurring an edge spreads the same excursion over more pixels. Both bands
        were captured at identical on-screen size. Figures from docs/spikes/optics-loupe.md.
      </p>
    </div>
  )
}
