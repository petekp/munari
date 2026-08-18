// Which authored element supplies the visible radius and shadow.
//
// React content lives inside Munari's square capture container. One authored
// root is the matter people see; adopted content already is that root.

/** The element whose visible chrome the mesh must wear. */
export function surfaceChromeElement(captureRoot: HTMLElement, adopted: boolean): HTMLElement {
  if (adopted) return captureRoot
  const children = Array.from(captureRoot.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  return children.length === 1 ? children[0]! : captureRoot
}
