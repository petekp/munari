// The marble page mirror — native content copied without taking its place.
//
// The law: the visible tree remains untouched. The 2026-08-30 colour-field
// approximation omitted every heading and label; reflection capture must
// instead contain the actual native subtree, including later DOM edits.
//
// Ownership: this helper owns only the copy. The capture host owns its
// placement and lifetime; native HTML still owns events and accessibility.

export function cloneMarbleHandPage(page: HTMLElement, width: number, height: number): HTMLElement {
  // SAFETY: cloning an HTMLElement preserves its element type. The DOM
  // signature returns Node because cloneNode also belongs to text nodes.
  const clone = page.cloneNode(true) as HTMLElement
  clone.setAttribute('data-marble-reflection-copy', '')
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.margin = '0'
  clone.style.boxSizing = 'border-box'

  const originals = [page, ...page.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  originals.forEach((original, index) => {
    const copy = copies[index]
    // Parked content never receives trusted pointer or focus events. These
    // paint-only twins preserve native state without replaying any action.
    copy.toggleAttribute('data-hover', original.hasAttribute('data-hover') || original.matches(':hover'))
    copy.toggleAttribute('data-active', original.hasAttribute('data-active') || original.matches(':active'))
    copy.toggleAttribute('data-focus-visible', original.hasAttribute('data-focus-visible') || original.matches(':focus-visible'))
    if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      copy.value = original.value
      copy.checked = original.checked
      copy.indeterminate = original.indeterminate
    } else if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
      copy.value = original.value
    } else if (original instanceof HTMLOptionElement && copy instanceof HTMLOptionElement) {
      copy.selected = original.selected
    }
  })
  return clone
}
