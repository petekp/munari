// Which authored element supplies the visible radius and shadow.
//
// React content lives inside Munari's square capture container. One authored
// root is the visible content; adopted content already is that root.

/** The element whose visible chrome the mesh must wear. */
export function surfaceChromeElement(captureRoot: HTMLElement, adopted: boolean): HTMLElement {
  if (adopted) return captureRoot
  let only: HTMLElement | null = null
  for (let child = captureRoot.firstElementChild; child; child = child.nextElementSibling) {
    if (!(child instanceof HTMLElement)) continue
    if (only) return captureRoot
    only = child
  }
  return only ?? captureRoot
}
