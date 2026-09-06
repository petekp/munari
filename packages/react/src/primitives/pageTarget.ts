// A page target keeps a Surface's React content mounted while its layout slot changes.
// Ref detachment moves the content to its retained home before React removes the old slot.
import { useLayoutEffect, useMemo } from 'react'
import { useLatest } from './useLatest'

export interface PageTarget {
  readonly ref: (element: HTMLElement | null) => void
}
interface PageTargetState {
  element: HTMLElement | null
  listeners: Set<() => void>
}
const targets = new WeakMap<PageTarget, PageTargetState>()

export function createPageTarget(): PageTarget {
  const state: PageTargetState = { element: null, listeners: new Set() }
  const target: PageTarget = { ref(element) {
    if (state.element === element) return
    state.element = element
    for (const listener of state.listeners) listener()
  } }
  targets.set(target, state)
  return target
}

export function usePageTarget(): PageTarget {
  return useMemo(createPageTarget, [])
}

function move(element: HTMLElement, parent: HTMLElement, before: ChildNode | null) {
  if ('moveBefore' in parent && element.isConnected && parent.isConnected) parent.moveBefore(element, before)
  else parent.insertBefore(element, before)
}

export function usePageTargetAttachment(
  target: PageTarget | undefined,
  boundary: HTMLElement | null,
  page: HTMLElement | null,
  hidden: boolean | undefined,
) {
  const hiddenRef = useLatest(hidden)
  useLayoutEffect(() => {
    if (!target || !boundary || !page) return
    const state = targets.get(target)
    if (!state) throw new Error('Surface.HTML target must come from usePageTarget or createPageTarget.')
    const parent = boundary.parentElement
    if (!parent) return
    const home = document.createComment('munari page target')
    parent.insertBefore(home, boundary)
    let alive = true
    const place = () => {
      const destination = state.element ?? parent
      if (destination.ownerDocument !== boundary.ownerDocument || boundary.contains(destination)) {
        throw new Error('A page target must be in the same document and outside its Surface content.')
      }
      if (boundary.parentElement !== destination) move(boundary, destination, state.element ? null : home.nextSibling)
      if (state.element) page.hidden = hiddenRef.current ?? false
      else queueMicrotask(() => {
        // A cross-column React commit detaches one slot and attaches the next.
        // Do not blur a focused field during that same-commit interval.
        if (alive && !state.element) page.hidden = true
      })
    }
    state.listeners.add(place)
    place()
    return () => {
      alive = false
      state.listeners.delete(place)
      if (home.parentElement && boundary.parentElement !== home.parentElement) move(boundary, home.parentElement, home.nextSibling)
      home.remove()
    }
  }, [target, boundary, page, hiddenRef])
  useLayoutEffect(() => {
    if (target && page) page.hidden = Boolean(hidden) || !targets.get(target)?.element
  }, [target, page, hidden])
}
