// The lab's last resort — what a scene shows instead of nothing when it
// throws.
//
// React unmounts the whole tree when a render or a layout effect throws,
// and an app with no boundary answers that with an empty <body>. The lab
// spent a day looking like a routing bug in Safari because of it: the
// genie film's context check read a missing `getContextAttributes().alpha`
// as a refusal and threw out of a ref callback, and the page went white
// with the reason only in the console (2026-08-23).
//
// This is deliberately not a retry button. A scene that threw during mount
// has partially-built GPU state behind it, and the honest recovery is a
// reload — what the reader needs from this box is the message and the
// stack, in the page, where they are looking.

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /**
   * Named in the heading, so a reader knows which scene died. The call site
   * also keys on it: a route change is a fresh mount, and without that one
   * broken scene would keep this box up over every scene after it.
   */
  scene: string
  children: ReactNode
}

interface State {
  error: Error | null
  stack: string | null
}

export class SceneBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Still console.error it: the boundary is for the reader, and the
    // console is where a debugger's breakpoints and source maps live.
    console.error('[lab] scene threw:', error)
    this.setState({ stack: info.componentStack ?? null })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    return (
      <div className="scene-error" role="alert">
        <h1>This example couldn’t load</h1>
        <p className="scene-error-hint">Reload to try again, or explore another example.</p>
        <p className="scene-error-actions">
          <button type="button" onClick={() => window.location.reload()}>Reload example</button>
          <a href="/?scene=home" target="_top">Back to overview</a>
        </p>
        <details>
          <summary>Error details: {this.props.scene}</summary>
          <p className="scene-error-message">{error.message}</p>
          {stack && <pre className="scene-error-stack">{stack.trim()}</pre>}
        </details>
      </div>
    )
  }
}
