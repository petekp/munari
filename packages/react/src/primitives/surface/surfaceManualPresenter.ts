// The manual presenter seam — a scene's own draw, counted in a Surface's
// readiness ledger.
//
// The law: a Surface releases the page only when every REGISTERED presenter
// has written color. `<Surface.Mesh>` registers itself and reports its own
// passes; a scene that draws a Surface's pixels some other way — a
// composite of a frozen film over the live capture, a caller-owned frame —
// has the same obligation and no component to discharge it.
//
// This is the whole of that seam, and deliberately not more. The lifetime
// and epoch a receipt has to carry are read here, at the moment of the
// report, rather than handed out: a caller holding them can report a draw
// under stamps it did not earn, which is a page released over pixels that
// were never on screen. `acquire`, `tick`, `setTiming`, and `setCallbacks`
// are not here at all — those are `<Surface>`'s, and a second writer for
// any of them is two callers arguing over one protocol.
//
// Ownership: this module owns nothing. It is a typed view of the store
// behind a handle, valid for as long as the handle is.

import type { SurfacePartId, SurfacePresenterKey } from '@munari/core'
import { DEFAULT_PART } from './surfaceContext'
import { surfaceStoreOf, type SurfaceHandle } from './surfaceHandle'


/** A scene-owned presenter of one Surface. */
export interface SurfaceManualPresenter {
  /**
   * Join the readiness ledger. The Surface cannot release its page copy
   * until this presenter has presented; the returned release leaves the
   * ledger, which is what an unmount mid-crossing owes it. `part` names
   * the part this presenter covers — omitted, the single-source root's
   * own part.
   */
  register(part?: SurfacePartId): () => void
  /**
   * Stage one: this presenter drew the uploaded pixels once. A write-free
   * warm-up counts — it is what opens the lift gate.
   */
  prove(): void
  /** Stage two: this presenter wrote color where it will be composited. */
  present(): void
  /** May this presenter's pixels be SEEN this frame? */
  canvasPresents(): boolean
  /**
   * May this presenter's matter HEAR the pointer this frame? Input follows
   * the eye (decisions.md #33): a scene-owned mesh that raycasts while this
   * is false routes clicks to the parked copy the viewer cannot see. Gate
   * the mesh's `raycast` on this, the way `<Surface.Mesh>` gates its own.
   */
  hearsPointer(): boolean
  /** Does the page copy still hold the pixels? */
  holdsPage(): boolean
}

/**
 * A scene-owned presenter for `handle`, named by `key`.
 *
 * The key is the ledger entry: one per presenter instance, stable for its
 * lifetime. Two live presenters sharing a key are one entry, and the
 * Surface releases the page when the first of them draws.
 */
export function surfaceManualPresenter(
  handle: SurfaceHandle,
  key: SurfacePresenterKey,
): SurfaceManualPresenter {
  const store = surfaceStoreOf(handle)
  return {
    register: (part = DEFAULT_PART) => {
      const releasePresentation = store.declarePresentation('canvas')
      const releaseManual = store.registerManualPresenter(part)
      const releasePresenter = store.registerPresenter(key)
      const releasePart = store.registerPartPresenter(part)
      return () => {
        releasePresentation()
        releaseManual()
        releasePresenter()
        releasePart()
      }
    },
    prove: () => store.prove(key, store.readinessLifetime(), store.epoch()),
    present: () => store.present(key, store.epoch()),
    canvasPresents: () => store.canvasPresents(),
    hearsPointer: () => store.canvasHearsPointer(),
    holdsPage: () => store.holdsPage(),
  }
}
