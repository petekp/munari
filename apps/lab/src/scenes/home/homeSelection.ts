// Headline selection — native ranges supply the raised glyphs' footprint.
// Rectangles stay in page coordinates, so scrolling changes their frame without
// rebuilding the glyph field. Input selections never raise headline geometry.
// HomeMasthead owns the easing and homeLight owns the shared depth test (#50).
import { useEffect, type RefObject } from 'react'

export interface HomeSelectionRect { x: number; y: number; width: number; height: number }
export interface HomeSelectionState { rects: HomeSelectionRect[]; target: number; amount: number; time: number }

export function advanceHeadlineSelection(selection: HomeSelectionState, reduced: boolean, now: number) {
  const dt = Math.min(0.05, (now-selection.time)/1000)
  selection.time = now
  selection.amount = reduced ? selection.target : selection.amount + (selection.target-selection.amount)*(1-Math.exp(-14*dt))
  if (Math.abs(selection.amount-selection.target)<0.0001) selection.amount=selection.target
}

export function useHeadlineSelection(headingRef: RefObject<HTMLElement | null>, anchorRef: RefObject<HTMLElement | null>, selection: HomeSelectionState, redraw: () => void) {
  useEffect(() => {
    const heading = headingRef.current, anchor = anchorRef.current
    if (!heading || !anchor) return
    const read = () => {
      const rects = headlineSelection(heading, anchor)
      selection.target = rects.length ? 1 : 0
      if (rects.length) selection.rects = rects
      redraw()
    }
    document.addEventListener('selectionchange', read)
    const observer = new ResizeObserver(read)
    observer.observe(heading)
    return () => {
      document.removeEventListener('selectionchange', read)
      observer.disconnect()
    }
  }, [headingRef,anchorRef,selection,redraw])
}

export function headlineSelection(title: HTMLElement, anchor: HTMLElement): HomeSelectionRect[] {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return []
  if (!title.contains(selection.anchorNode) || !title.contains(selection.focusNode)) return []
  const origin = anchor.getBoundingClientRect()
  const rects: HomeSelectionRect[] = []
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index)
    for (const line of title.querySelectorAll(':scope > span')) {
      if (!range.intersectsNode(line)) continue
      const selected = document.createRange()
      selected.selectNodeContents(line)
      if (line.contains(range.startContainer)) selected.setStart(range.startContainer, range.startOffset)
      if (line.contains(range.endContainer)) selected.setEnd(range.endContainer, range.endOffset)
      const box = line.getBoundingClientRect()
      // Font selection boxes can overlap the preceding line when line-height
      // is tight. Only this line's glyphs may rise (decision #50).
      for (const rect of selected.getClientRects()) {
        const top = Math.max(rect.top,box.top)
        const bottom = Math.min(rect.bottom,box.bottom)
        if (rect.width < 1 || bottom-top < 1) continue
        const next = { x: rect.left-origin.left, y: top-origin.top, width: rect.width, height: bottom-top }
        if (!rects.some(previous => previous.x===next.x && previous.y===next.y && previous.width===next.width && previous.height===next.height)) rects.push(next)
      }
    }
  }
  return rects.slice(0, 8)
}
