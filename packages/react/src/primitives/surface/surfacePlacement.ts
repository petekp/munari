// Surface placement observation — position changes do not trigger ResizeObserver.
// The idle-canvas sibling probe failed on 2026-09-06 (decision #42). One
// shared frame observer compares client boxes and wakes only moved surfaces.
// Renderers still own projection; this observer owns neither motion nor holds.
interface Box { readonly element: Element; readonly left: number; readonly top: number; readonly width: number; readonly height: number }
interface Watch { readonly elements: readonly (() => Element | null | undefined)[]; readonly changed: () => void; readonly readClip?: () => string; clip?:string; boxes: readonly (Box | null)[] }
const watches = new Set<Watch>()
let frame: number | null = null
function sample() {
  frame = null
  const cache = new Map<Element, Box>()
  for (const watch of [...watches]) {
    const boxes = watch.elements.map(read => {
      const element = read()
      if (!element) return null
      const existing = cache.get(element)
      if (existing) return existing
      const { left, top, width, height } = element.getBoundingClientRect()
      const box = { element, left, top, width, height }
      cache.set(element, box)
      return box
    })
    const clip=watch.readClip?.()
    const changed = clip!==watch.clip||boxes.some((box, index) => {
      const before = watch.boxes[index]
      return box?.element !== before?.element || box?.left !== before?.left || box?.top !== before?.top || box?.width !== before?.width || box?.height !== before?.height
    })
    watch.boxes = boxes
    watch.clip=clip
    if (changed) watch.changed()
  }
  // A callback may already have scheduled a frame while registering a watcher.
  if (watches.size > 0 && frame === null) frame = requestAnimationFrame(sample)
}
export function watchSurfacePlacement(elements: Watch['elements'], changed: () => void, readClip?:()=>string): () => void {
  const watch: Watch = { elements, changed, readClip, boxes: [] }
  watches.add(watch)
  if (frame === null) frame = requestAnimationFrame(sample)
  return () => {
    watches.delete(watch)
    if (watches.size === 0 && frame !== null) { cancelAnimationFrame(frame); frame = null }
  }
}
