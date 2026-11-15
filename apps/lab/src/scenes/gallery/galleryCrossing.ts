// Gallery crossing — the selected DOM edit gates automatic travel.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSurfaceSupport, useSurfaceTextureOf, type SurfaceHandle } from '@petepetrash/munari'
import type { WebGPURenderer } from 'three/webgpu'
import type { Texture } from 'three'
import { readSurfaceFrame, uploadSurfaceFrame, waitForSurfaceFrame, type LabSurfaceFrame } from '../../lib/surfaceFrames'
import { springEase } from '../refraction/refractionLaw'
import { galleryTuning as tune } from './galleryTuning'

type Slot = 0 | 1
type CardSlot = { item: number; revision: number }
type GalleryEdit = { from: Slot; to: Slot; revision: number }

const READ_DEADLINE_MS = 2500

export function useGalleryCrossing(surface: SurfaceHandle, itemCount: number, renderer: React.RefObject<WebGPURenderer | null>) {
  const supported = useSurfaceSupport()
  const left = useSurfaceTextureOf(surface, 'item-0')
  const right = useSurfaceTextureOf(surface, 'item-1')
  const revision = useRef(0)
  const expected = useRef<{ frame: LabSurfaceFrame; finish: () => void } | null>(null)
  const [edit, setEdit] = useState<GalleryEdit | null>(null)

  /** Which item each part is holding. */
  const [slots, setSlots] = useState<[CardSlot, CardSlot]>([{ item: 0, revision: 0 }, { item: 1, revision: 0 }])
  const [p, setP] = useState(0)
  const [running, setRunning] = useState(false)

  /**
   * Which part the current crossing started from — the one the mesh is
   * drawing, and the one whose field decides where the drop opens.
   *
   * State and not a ref, because the meshes' `part` and `sampledParts`
   * props are derived from it. It is written only while the crossing is
   * landed, so a part cannot change role in the middle of one; a mesh whose
   * part swapped mid-flight would hand the sheet back for a frame.
   */
  const [origin, setOrigin] = useState<Slot>(0)

  // Which part the compositor is holding, if either. At both ends of the
  // crossing one of them is ordinary DOM — selectable, focusable, and
  // hit-tested — and the other is a resident source. In between the answer
  // is NEITHER: the mesh owns the sheet and both items feed it by part.
  const landedAt: Slot | null = running ? null : p === 0 ? 0 : p === 1 ? 1 : null
  const lifted = landedAt === null

  const current = landedAt === null ? null : slots[landedAt].item

  // Preload the next item into the hidden part once the current choice lands.
  useEffect(() => {
    if (landedAt === null || edit) return
    setSlots((current) => {
      const want = (current[landedAt].item + 1) % itemCount
      const hidden = landedAt === 0 ? 1 : 0
      if (current[hidden].item === want) return current
      const next: [CardSlot, CardSlot] = [...current]
      next[hidden] = { item: want, revision: 0 }
      return next
    })
  }, [edit, itemCount, landedAt])

  const goTo = (item: number) => {
    if (landedAt === null || item === slots[landedAt].item) return
    const to = landedAt === 0 ? 1 : 0
    const id = ++revision.current
    expected.current = null
    setSlots((current) => {
      const next: [CardSlot, CardSlot] = [...current]
      next[to] = { item, revision: id }
      return next
    })
    if (!supported) {
      setP(to)
      return
    }
    setOrigin(landedAt)
    setEdit({ from: landedAt, to, revision: id })
  }

  const destinationTexture = edit?.to === 0 ? left : right
  useEffect(() => {
    if (!edit) return
    const controller = new AbortController()
    const finish = (ready: boolean) => {
      if (controller.signal.aborted || revision.current !== edit.revision) return
      controller.abort()
      expected.current = null
      clearTimeout(timeout)
      if (ready) {
        setOrigin(edit.from)
        setRunning(true)
      } else {
        setP(edit.to)
      }
      setEdit(null)
    }
    const timeout = setTimeout(() => finish(false), READ_DEADLINE_MS)
    if (destinationTexture) {
      const marker = `[data-gallery-edit="${edit.revision}"]`
      void waitForSurfaceFrame(
        destinationTexture,
        (content) => content.querySelector(marker) !== null,
        controller.signal,
        () => renderer.current,
      ).then((frame) => {
        if (frame && !controller.signal.aborted && revision.current === edit.revision) {
          expected.current = { frame, finish: () => finish(true) }
        }
      })
    }
    return () => {
      expected.current = null
      clearTimeout(timeout)
      controller.abort()
    }
  }, [destinationTexture, edit, renderer])

  const prepareIncomingDraw = useCallback((bound: Texture, currentRenderer: WebGPURenderer) => {
    const request = expected.current
    if (!request || request.frame.texture !== bound) return
    const frame = readSurfaceFrame(bound)
    const matchesEdit = frame && frame.paint.frame.sourceId === request.frame.paint.frame.sourceId &&
      frame.paint.read >= request.frame.paint.read
    if (!matchesEdit || !uploadSurfaceFrame(frame, currentRenderer)) return
    return () => queueMicrotask(() => {
      if (expected.current === request) request.finish()
    })
  }, [])

  // The animated crossing. Driven from `requestAnimationFrame` rather than
  // the renderer's frame because it also moves the scrub input, which is
  // page DOM — the material reads `drive.current` and never waits on React.
  useEffect(() => {
    if (!running) return
    const from = p
    const to = from < 0.5 ? 1 : 0
    const span = tune.crossingMs * Math.abs(to - from)
    const start = performance.now()
    let raf = 0
    const step = () => {
      const q = span <= 0 ? 1 : Math.min(1, (performance.now() - start) / span)
      // Eased here rather than inside the law: the law is a function of the
      // scrub, and the scrub is also a slider a hand drags. Easing it there
      // would bend the hand's own timing and move where a parked scrub sits.
      setP(from + (to - from) * springEase(q, tune.crossingSpring))
      if (q < 1) raf = requestAnimationFrame(step)
      else setRunning(false)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // Deliberately not depending on `p`: the effect reads the start value
    // once and owns `p` until it finishes. Re-running on every write would
    // restart the crossing from wherever it had got to, forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // A hand dragging the scrub away from an end starts a crossing too, and
  // it starts from the end it left.
  const onScrub = useCallback(
    (next: number) => {
      if (landedAt !== null) setOrigin(landedAt)
      setP(next)
    },
    [landedAt],
  )

  const cross = () => {
    if (landedAt !== null) setOrigin(landedAt)
    setRunning(true)
  }

  return { slots, p, running, pending: edit !== null, origin, landedAt, lifted, current, goTo, onScrub, cross, prepareIncomingDraw }
}
