// Plume release bridge — the ink capture's anchors, as UV rects, for the release cloud.
//
// The law: it reports only when one frame holds every requested anchor, once
// per frame generation, so releases are never stamped against boxes from a
// different capture. A frame whose anchors are null reports nothing.

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useCaptureFrame, type CaptureHandle, type SourceUvRect } from '@petepetrash/munari'

export function PlumeReleaseBridge({ capture, ids, onAnchors }: {
  capture: CaptureHandle
  ids: readonly string[]
  onAnchors: (anchors: Readonly<Record<string, SourceUvRect>>) => void
}) {
  const frames = useCaptureFrame(capture)
  const last = useRef('')
  useFrame(() => {
    const frame = frames.get()
    const boxes = frame?.anchors
    if (!frame || !boxes || ids.some(id => !boxes[id])) return
    const key = `${frame.sourceId}:${frame.generation}:${ids.join('|')}`
    if (last.current === key) return
    last.current = key
    const anchors: Record<string, SourceUvRect> = {}
    for (const id of ids) {
      const box = boxes[id]
      anchors[id] = { cssWidth: box.width, cssHeight: box.height, uMin: box.x / frame.width, uMax: (box.x + box.width) / frame.width,
        vMin: 1 - (box.y + box.height) / frame.height, vMax: 1 - box.y / frame.height }
    }
    onAnchors(anchors)
  })
  return null
}
