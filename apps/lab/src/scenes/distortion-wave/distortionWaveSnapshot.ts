// Wave snapshots — detached copies of this scene's styled controls.
// The scene's ancestor classes preserve CSS context without per-node style serialization.
import { Color } from 'three'

export interface WaveSnapshot {
  element: HTMLElement
  size: readonly [number, number]
  bounds: DOMRect
  background: Color
}

function flatBackground(element: HTMLElement): string {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const color = getComputedStyle(parent).backgroundColor
    if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
  }
  return '#09090b'
}

export function waveTargetBounds(
  target: HTMLElement,
  rect = target.getBoundingClientRect(),
): DOMRect | null {
  if (!target.isConnected) return null
  const pageTarget = target.hasAttribute('data-wave-page')
  const left = pageTarget ? Math.max(0, rect.left) : rect.left
  const top = pageTarget ? Math.max(0, rect.top) : rect.top
  const width = pageTarget
    ? Math.min(innerWidth, rect.right) - left
    : rect.width
  const height = pageTarget
    ? Math.min(innerHeight, rect.bottom) - top
    : rect.height
  if (width <= 0 || height <= 0) return null
  return new DOMRect(left, top, width, height)
}

export function createWaveSnapshot(target: HTMLElement): WaveSnapshot | null {
  const rect = target.getBoundingClientRect()
  const page = target.closest<HTMLElement>('.wave-page')
  if (!page) throw new Error('Wave targets belong to the wave page')
  const bounds = waveTargetBounds(target, rect)
  if (!bounds) return null
  const { left, top, width, height } = bounds
  const background = flatBackground(target)
  const root = document.createElement('div')
  root.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${background};`
  root.dataset.waveSnapshot = ''
  // SAFETY: cloning an HTMLElement preserves its element type.
  const copy = target.cloneNode(true) as HTMLElement
  const originals = [target, ...target.querySelectorAll('*')]
  const copies = [copy, ...copy.querySelectorAll('*')]
  originals.forEach((original, index) => {
    const cloned = copies[index]
    if (!cloned) return
    cloned.removeAttribute('id')
    cloned.toggleAttribute('data-hover', original.matches(':hover'))
    cloned.toggleAttribute('data-active', original.matches(':active'))
    cloned.toggleAttribute(
      'data-focus-visible',
      original.matches(':focus-visible'),
    )
    if (
      original.hasAttribute('data-wave-highlight') &&
      cloned instanceof HTMLElement
    ) {
      cloned.style.opacity = getComputedStyle(original).opacity
      cloned.style.transition = 'none'
    }
    if (
      original instanceof HTMLSelectElement &&
      cloned instanceof HTMLSelectElement
    )
      cloned.selectedIndex = original.selectedIndex
  })
  copy.style.position = 'absolute'
  copy.style.left = `${rect.left - left}px`
  copy.style.top = `${rect.top - top}px`
  copy.style.margin = '0'
  copy.style.width = `${rect.width}px`
  copy.style.height = `${rect.height}px`
  copy.style.boxSizing = 'border-box'
  copy.style.transform = 'none'
  let branch: HTMLElement = copy
  for (
    let parent = target.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    // SAFETY: every ancestor in this HTML scene is an HTMLElement.
    const context = parent.cloneNode(false) as HTMLElement
    context.removeAttribute('id')
    context.style.cssText += `;display:block;position:static;width:${rect.width}px;height:${rect.height}px;min-width:0;min-height:0;max-width:none;max-height:none;padding:0;margin:0;border:0;border-radius:0;background:none;overflow:visible;transform:none;box-shadow:none;`
    context.append(branch)
    branch = context
    if (parent === page) break
  }
  root.append(branch)
  return {
    element: root,
    size: [width, height],
    bounds: new DOMRect(left, top, width, height),
    background: new Color(background),
  }
}
