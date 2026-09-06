// Code blocks with a small hand-rolled highlighter. The landing page shows
// a handful of short, static snippets, so a ~40-line tokenizer beats a
// highlighting dependency: no bundle cost, and a token it misclassifies is
// visible in review because every snippet on the page is right here.
import { useState, type ReactNode } from 'react'

// One combined pass; earlier alternatives win. Comments and strings first
// so a keyword inside either never matches on its own.
const TOKEN =
  /(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|(<\/?[A-Za-z][\w.]*|\/>)|\b(import|from|export|const|let|var|function|return|if|else|async|await|new|type)\b|(\b\d+(?:\.\d+)?\b)/g

const CLASS = ['hc-com', 'hc-str', 'hc-tag', 'hc-key', 'hc-num']

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let cursor = 0
  let key = 0
  for (const m of code.matchAll(TOKEN)) {
    const at = m.index
    if (at > cursor) out.push(code.slice(cursor, at))
    const group = m.slice(1).findIndex((g) => g !== undefined)
    out.push(
      <span key={key++} className={CLASS[group]}>
        {m[0]}
      </span>,
    )
    cursor = at + m[0].length
  }
  if (cursor < code.length) out.push(code.slice(cursor))
  return out
}

export function CodeBlock({ code, title = 'React' }: { code: string; title?: string }) {
  const [status, setStatus] = useState('Copy')
  return (
    <div className="home-code-block" data-relief="well">
      <div className="home-code-heading">
        <span>{title}</span>
        <button type="button" aria-label={`Copy ${title}`} onClick={async () => {
          try {
            await navigator.clipboard.writeText(code)
            setStatus('Copied')
          } catch {
            setStatus('Select and copy the code below')
          }
        }}><span aria-live="polite">{status}</span></button>
      </div>
      <pre className="home-code" tabIndex={0} aria-label={title}><code>{highlight(code)}</code></pre>
    </div>
  )
}
