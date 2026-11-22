// Genie's window content — the two drawn studies and the bouncing marks,
// the window bodies that move on their own. The marks' simulation lives in
// genieBounce.ts; the window frame and the flight stay in Genie.tsx.

import { useLayoutEffect, useRef } from 'react'
import { BOUNCE_MARKS, registerBounceCourt } from './genieBounce'

// Two of the studies. Each figure is drawn at its viewBox size exactly,
// so one strokeWidth means one rendered hairline — the same 1.5px the
// bays are drawn at, which is what makes the big figure and its 20px bay
// read as the same hand rather than two drawings of the same shape.
//
// The triangolo has no study. Its window is the film (below), and the
// trade is the point: the other two windows show a figure drawn, this
// one shows the man who drew them turning one by hand.
export type StudyId = 'quadrato' | 'cerchio'

type GenieMotionStyle = React.CSSProperties & {
  '--line-delay'?: string
  '--line-opacity'?: number
}

export function StudyPattern({ kind }: { kind: StudyId }) {
  const lines = Array.from({ length: kind === 'quadrato' ? 7 : 9 })
  return (
    <svg
      className="gen-math-pattern"
      data-pattern={kind}
      viewBox="0 0 120 120"
      aria-hidden
    >
      {lines.map((_, i) => {
        const style: GenieMotionStyle = {
          '--line-delay': `${i * 0.12}s`,
          '--line-opacity': 0.28 + i * 0.075,
        }
        if (kind === 'quadrato') {
          const inset = 12 + i * 4.8
          return (
            <rect
              key={i}
              className="gen-math-line"
              x={inset}
              y={inset}
              width={120 - inset * 2}
              height={120 - inset * 2}
              rx={1.5 + i * 0.2}
              pathLength="100"
              transform={`rotate(${i * 11.25} 60 60)`}
              style={style}
            />
          )
        }
        return (
          <ellipse
            key={i}
            className="gen-math-line"
            cx="60"
            cy="60"
            rx="46"
            ry="19"
            pathLength="100"
            transform={`rotate(${i * 20} 60 60)`}
            style={style}
          />
        )
      })}
    </svg>
  )
}

// One bouncing mark. The box is the mark's rest diameter; the shared
// simulation (genieBounce.ts) positions it by inline transform, so its
// layout stays put and the capture sees the same numbers the page
// draws. Strokes are non-scaling: the size knob resizes the figure,
// not the pen.
function BounceMark({ index }: { index: number }) {
  const mark = BOUNCE_MARKS[index]
  const d = mark.r * 2
  return (
    <div className="gen-bounce" data-mark={mark.id} style={{ width: d, height: d }}>
      <svg
        className="gen-bounce-figure"
        viewBox="0 0 100 100"
        style={{ color: mark.color }}
        aria-hidden
      >
        {mark.id === 'quadrato' && (
          <rect className="gen-mark-stroke" x="4" y="4" width="92" height="92" rx="6" />
        )}
        {mark.id === 'cerchio' && <circle className="gen-mark-stroke" cx="50" cy="50" r="46" />}
        {mark.id === 'triangolo' && (
          <polygon className="gen-mark-stroke" points="50,5 96,95 4,95" />
        )}
      </svg>
    </div>
  )
}

// The marks' layer, its own component so its court registers with the
// simulation when it mounts.
export function PlayLayer() {
  // Live content, not decoration. On HTML-in-canvas the marks keep
  // bouncing through a flight; on snapDOM, where `live` takes no effect,
  // they are held for it (`holdBounceMarks`).
  //
  // The simulation writes inline transforms, so the snapshot of this window
  // that the capture reads carries the same numbers as the live marks.
  // Layout effect, so the marks are in position before their first paint.
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => registerBounceCourt(root.current!), [])
  return (
    <div className="gen-play" aria-hidden ref={root}>
      {BOUNCE_MARKS.map((mark, i) => (
        <BounceMark key={mark.id} index={i} />
      ))}
    </div>
  )
}
