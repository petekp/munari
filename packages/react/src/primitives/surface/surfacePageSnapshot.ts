// Page snapshot — the copy a Surface keeps on the page, and the test for when
// the live node must stand in for it.
//
// The law: while a Surface stays on the page, its capture root holds a
// structural clone carrying form values, checked/indeterminate state, scroll
// offsets, canvas bitmaps, and hover/active/focus-visible attribute twins.
// Only active browser focus or a non-collapsed text selection inside the
// subtree requires borrowing the live node ahead of the crossing (decisions.md
// #63).
//
// The fault, 2026-09-13: preparation stood the capture host over a page copy
// it assumed was showing, guarded by `holder.hidden`, which CSS never
// touches, so a docked window flashed at its desk position. Preparation now
// borrows the live node only when focus or a selection needs it.
//
// Ownership: this module builds copies and answers eligibility. Surface.tsx
// decides when to borrow the live node.

import { copyFieldState } from '../elementCapture'
import type { ScrollOffsets } from '../retainedMove'

export interface PageSnapshot {
  readonly node: HTMLElement
  readonly key: string
  readonly scrolls: ScrollOffsets
}

export function unsupportedSnapshot(root: HTMLElement): string | null {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (
      ['iframe', 'video', 'audio', 'object', 'embed'].includes(element.localName) ||
      element.localName.includes('-') ||
      element.hasAttribute('is') ||
      element.shadowRoot
    ) {
      return `The single-instance handoff has not validated <${element.localName}>; keep this content native.`
    }
    if (
      element.hasAttribute('form') ||
      element.getAttributeNames().some((name) => name.startsWith('on') && name in Object.getPrototypeOf(element))
    ) {
      return 'Explicit form associations and inline DOM handlers remain native.'
    }
    const form =
      element instanceof HTMLInputElement ||
      element instanceof HTMLButtonElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLFieldSetElement
        ? element.form
        : null
    if (form && !root.contains(form)) return 'Keep the form and its controls inside the same Surface.'
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name && !form) {
      return 'Named radio groups without a containing form remain native.'
    }
  }
  return null
}

/**
 * A copy of the live content, and a key naming everything in that copy.
 *
 * Measured 2026-09-11 over one card drag on a nine-card board: 40 of 41 rebuilt
 * copies were byte-for-byte the copy already in place; comparing the key first
 * drops redundant captures from 65 to 40 (~140 ms to ~115 ms). Call
 * `matchMotion` after inserting the copy so CSS animations keep the live pose
 * (decisions.md #66).
 */
export function snapshotPageContent(
  root: HTMLElement,
  unsupported: string | null = unsupportedSnapshot(root),
): PageSnapshot {
  if (unsupported) return { node: document.createElement('div'), key: '', scrolls: [] }
  // SAFETY: cloning an HTMLElement preserves its element type.
  const copy = root.cloneNode(true) as HTMLElement
  copy.dataset.munariSnapshot = ''
  const originals = [root, ...root.querySelectorAll('*')]
  const copies = [copy, ...copy.querySelectorAll('*')]
  const state: string[] = []
  const scrolls: ScrollOffsets = []
  originals.forEach((original, index) => {
    const target = copies[index]
    if (!target) return
    target.removeAttribute('id')
    target.removeAttribute('data-api-live')
    target.toggleAttribute('data-hover', original.matches(':hover') || original.hasAttribute('data-hover'))
    target.toggleAttribute('data-active', original.matches(':active') || original.hasAttribute('data-active'))
    target.toggleAttribute('data-focus-visible', original.matches(':focus-visible'))
    copyFieldState(original, target, scrolls)
    if (original instanceof HTMLInputElement) {
      state.push(`${index}v${original.value}|${original.checked}|${original.indeterminate}`)
    } else if (original instanceof HTMLTextAreaElement) {
      state.push(`${index}v${original.value}`)
    } else if (original instanceof HTMLSelectElement) {
      state.push(`${index}s${original.selectedIndex}`)
    } else if (original instanceof HTMLCanvasElement && target instanceof HTMLCanvasElement) {
      target.getContext('2d')?.drawImage(original, 0, 0)
    }
    if (original.scrollTop || original.scrollLeft) {
      state.push(`${index}o${original.scrollTop},${original.scrollLeft}`)
    }
  })
  return { node: copy, key: `${copy.outerHTML}\u0000${state.join('\u0000')}`, scrolls }
}

export function placeholderCopy(liveRoot: HTMLElement, unsupported?: string | null): HTMLElement {
  const { node: copy } = snapshotPageContent(liveRoot, unsupported)
  copy.inert = true
  copy.setAttribute('aria-hidden', 'true')
  copy.style.visibility = 'hidden'
  return copy
}

/**
 * Does this content have something the page-side copy cannot carry? A
 * snapshot reproduces markup, field values, checked state, scroll offsets and
 * the hover/active/focus-visible twins. A blinking caret and a selection
 * highlight belong to the node that owns them, and a clone has neither. The
 * live node is worth borrowing exactly when one of those is present.
 */
export function sourceNeedsLiveNode(root: HTMLElement): boolean {
  const doc = root.ownerDocument
  if (root.contains(doc.activeElement)) return true
  const selection = doc.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.containsNode(root, true))
}
