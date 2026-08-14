/** The minimum scene-graph shape needed to stop an outgoing presenter. */
export interface RendererPresenter {
  visible: boolean
}

export interface RendererReleaseFrame {
  /** The renderer-owned object that must leave this frame. */
  outgoing: RendererPresenter
  /**
   * Synchronously give the incoming presenter every visual layer that the
   * outgoing presenter is about to stop drawing.
   */
  commitIncoming: () => void
  /** Publish the durable hold after the current renderer stack has drawn. */
  publishRelease: () => void
}

/**
 * Commit a reverse handoff inside an r3f `useFrame` callback.
 *
 * The incoming presenter is committed before the outgoing object is hidden.
 * Both writes are synchronous, so the browser cannot composite between them.
 * The microtask runs after r3f's current render stack, which lets React publish
 * durable state without stopping the draw that erases the old presenter.
 */
export function commitRendererReleaseFrame({
  outgoing,
  commitIncoming,
  publishRelease,
}: RendererReleaseFrame): void {
  commitIncoming()
  outgoing.visible = false
  queueMicrotask(publishRelease)
}
