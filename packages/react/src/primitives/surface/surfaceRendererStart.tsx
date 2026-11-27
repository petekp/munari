// Renderer start — the boundary that keeps a renderer that could not start
// at the Canvas.
//
// The fault: Fiber 9.8.1 throws the renderer factory's rejection while
// rendering the Canvas, so a browser with no GPU unmounted the caller's
// whole tree, page HTML included.
//
// Ownership: SurfaceCanvas throws RendererStartError from its factory and
// wraps its Canvas in the boundary; nothing else here.

import { Component, type ReactNode } from 'react'

export class RendererStartError extends Error {}

/**
 * Keeps a renderer that could not start at the Canvas.
 *
 * Fiber 9.8.1 throws the factory's rejection while rendering the Canvas, so
 * without this a browser with no GPU unmounts the caller's whole tree, page
 * HTML included. A start failure is reported to the window's error handlers
 * and the Canvas renders nothing, which leaves `fallback` showing; any other
 * error goes on to the caller's boundaries.
 */
interface RendererStartState {
  readonly error: Error | null
}

export class RendererStartBoundary extends Component<{ children: ReactNode }, RendererStartState> {
  state: RendererStartState = { error: null }

  static getDerivedStateFromError(error: Error): RendererStartState {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (error instanceof RendererStartError) reportError(error)
  }

  render() {
    const { error } = this.state
    if (error === null) return this.props.children
    if (error instanceof RendererStartError) return null
    throw error
  }
}
