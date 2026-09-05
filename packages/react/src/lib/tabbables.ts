// Tab-sequence computation for Surface source subtrees — the subset of the
// `tabbable` library's rules that can occur in Surface markup (docs/focus.md
// "Surface markup rules"). No shadow DOM, slots, or iframes: sources are
// plain parked subtrees. Deliberately NOT cached: a Tab press is human-rate
// and subtrees are small, so recomputing at each keydown keeps boundary
// interception (element identity of first/last) always-fresh. If a giant
// source ever makes getClientRects walks hurt, the cache key is the source's
// paintCount — invalidate on advance.

const CANDIDATES = [
  'input',
  'select',
  'textarea',
  'a[href]',
  'button',
  '[tabindex]',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  'details>summary:first-of-type',
  'details',
].join(',')

/** Pure ordering rule, exported for tests: positive tabindexes first in
 *  ascending order (document order among equals), then the tabindex-0 crowd
 *  in document order. Authored Surface markup bans positive tabindex, but
 *  the sort stays correct if one sneaks in. Stable by construction (seq). */
export function sortByTabOrder<T extends { tabIndex: number; seq: number }>(items: T[]): T[] {
  const positive = items
    .filter((i) => i.tabIndex > 0)
    .sort((a, b) => a.tabIndex - b.tabIndex || a.seq - b.seq)
  const zero = items.filter((i) => i.tabIndex <= 0).sort((a, b) => a.seq - b.seq)
  return [...positive, ...zero]
}

/** Pure radio rule, exported for tests: a named radio group collapses to one
 *  stop only when SOME member is checked (the checked one). No checked
 *  member → every radio is a stop, matching native Chrome and `tabbable`. */
export function radioIsStop(group: { checked: boolean }[], index: number): boolean {
  const checkedIdx = group.findIndex((r) => r.checked)
  return checkedIdx === -1 || checkedIdx === index
}

/** Boolean presence of an explicit `tabindex` attribute (the `tabbable`
 *  library's `hasTabIndex`). `parseInt` on a missing attribute is `NaN`, so
 *  only a literal — even `"-1"` — counts; this is what distinguishes a
 *  genuine `[tabindex="-1"]` removal (which must stay dropped) from a
 *  contenteditable that simply reports a negative IDL `tabIndex` by default. */
const hasTabIndexAttr = (el: HTMLElement): boolean =>
  !Number.isNaN(parseInt(el.getAttribute('tabindex') ?? '', 10))

/** The effective tab index of an element, transcribing `tabbable`'s
 *  `getTabIndex`. In Chrome an `<audio controls>`/`<video controls>`/
 *  `<details>`, and a `contentEditable` element without an explicit
 *  `tabindex`, reports an IDL `tabIndex` of `-1` even though Chrome places it
 *  in the real Tab order; `tabbable` treats those as effective `0`. The
 *  attribute check keeps a genuine `[tabindex="-1"]` removal dropped — the
 *  quirk only rescues elements that never declared a tabindex. The
 *  AV/DETAILS arms are parity with `tabbable` even though Surface markup
 *  bans them (docs/focus.md "Surface markup rules"); `contenteditable` is
 *  the rule-permitted case that ships (the lab notes panel). */
export function effectiveTabIndex(el: HTMLElement): number {
  if (el.tabIndex < 0) {
    const editableAttr = el.getAttribute('contenteditable')
    const nativeTabStopByDefault =
      /^(AUDIO|VIDEO|DETAILS)$/.test(el.tagName) ||
      editableAttr === '' ||
      editableAttr === 'true'
    if (nativeTabStopByDefault && !hasTabIndexAttr(el)) return 0
  }
  return el.tabIndex
}

function isRadio(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'radio'
}

function radioTabbable(el: HTMLInputElement, root: ParentNode): boolean {
  if (!el.name) return true
  const scope: ParentNode = el.form ?? root
  const group = [...scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
    (r) => r.name === el.name,
  )
  return radioIsStop(group, group.indexOf(el))
}

/**
 * Tabbable elements under `root` in Tab order. The pure pieces above carry
 * node-environment unit tests; the walk itself is pinned by the happy-dom
 * suite in `tabbables.dom.test.ts` (which models Chrome's IDL `tabIndex`
 * quirk for contenteditable), and re-verified against real Chromium via the
 * platform probes in docs/focus.md.
 */
export function tabbables(root: ParentNode): HTMLElement[] {
  const found: { el: HTMLElement; tabIndex: number; seq: number }[] = []
  let seq = 0
  for (const el of root.querySelectorAll<HTMLElement>(CANDIDATES)) {
    // :disabled covers the element AND fieldset-disabled propagation.
    if (el.matches(':disabled')) continue
    if (el instanceof HTMLInputElement && el.type === 'hidden') continue
    // A <details> with a <summary> yields focus to the summary, not itself.
    if (el instanceof HTMLDetailsElement && el.querySelector(':scope>summary')) continue
    if (isRadio(el) && !radioTabbable(el, root)) continue
    // el.tabIndex (IDL) resolves defaults per element type; the attribute
    // check keeps [tabindex="-1"] unit containers out of the walk. A bare
    // contenteditable reports IDL -1 in Chrome yet is a real tab stop, so
    // effectiveTabIndex (transcribing `tabbable`'s getTabIndex) lifts it to
    // 0 only when no explicit tabindex is present — keeping genuine
    // [tabindex="-1"] removals dropped.
    const tabIndex = effectiveTabIndex(el)
    if (tabIndex < 0) continue
    // Zero client rects = display:none somewhere above, closed <details>
    // content, etc. opacity:0 proxies still have rects — stays tabbable.
    if (el.getClientRects().length === 0) continue
    found.push({ el, tabIndex, seq: seq++ })
  }
  return sortByTabOrder(found).map((f) => f.el)
}
