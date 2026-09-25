// Home graphics boundary — a thrown masthead setup selects native content.
// The masthead mounts the lighting, lamp, headline and postcard renderers; the
// opening owns the reveal, so a throw here must not unmount the opening.
//
// Fault: the deployed lighting setup threw in WebKit (see homeOpening.ts). The
// error reached the scene boundary outside Home, and every iOS browser kept the
// cover up indefinitely. Measured 2026-09-25 in WebKitGTK 2.52 at phone size:
// the throw at 3.6s, the cover still up at 90s (decision #69).
//
// Ownership: this boundary reports the failure and remounts its subtree once
// the opening is native; useHomeOpening owns the phase and the reveal.

import { Component, type ReactNode } from 'react'

interface Props {
  /** The opening selected native content, which mounts none of the renderers. */
  native: boolean
  onFailure: () => void
  children: ReactNode
}

interface State {
  failed: boolean
  native: boolean
}

export class HomeGraphicsBoundary extends Component<Props, State> {
  state: State = { failed: false, native: false }

  static getDerivedStateFromProps(props: Props, state: State): State | null {
    if (props.native === state.native) return null
    // One fresh mount without the effects that threw. A throw from native
    // content itself stays caught here, and the native opening still reveals
    // the rest of the page.
    return { failed: false, native: props.native }
  }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('[home] graphics setup threw; showing native content:', error)
    this.props.onFailure()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
