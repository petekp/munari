// Full capture background — independently retained root paint from a public SVG.
// Reuse requires matching serialized paint and geometry after removing inactive defaults.
// Controls' full source draw reached 136.3 ms at 6× on 2026-10-14;
// the region rasterizer owns publication and this cache's lifetime.

import { captureContext, captureMemoryChosen } from '@munari/core'

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
// Bound retained background memory while covering a 1520×1080 RGBA plane
// (decisions.md #62); replacement can briefly retain two such buffers.
const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024
const CONTAINERS = new Set(['div', 'form', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav'])
const INACTIVE_MASK_PROPERTIES = ['mask-position', 'mask-size', 'mask-repeat', 'mask-mode', 'mask-composite', 'mask-origin', 'mask-clip'] as const
const FOREGROUND_OVERRIDES = [
  ['background-image', 'none'], ['background-color', 'transparent'],
  ['box-shadow', 'none'], ['border-color', 'transparent'], ['border-image-source', 'none'],
] as const

interface BackgroundFrame {
  key: string
  canvas: HTMLCanvasElement
}

interface MatchedRule {
  rule: CSSStyleRule
  specificity: number
  order: number
}

function ordinary(value: string, expected: string): boolean {
  return value === '' || value === 'initial' || value === 'unset' || value === expected
}

function inlineStyle(element: Element): CSSStyleDeclaration | null {
  return element instanceof HTMLElement || element instanceof SVGElement ? element.style : null
}

function parseSvg(url: string): XMLDocument | null {
  const comma = url.indexOf(',')
  if (comma < 0 || !url.startsWith('data:image/svg+xml') || url.slice(0, comma).includes(';base64')) return null
  const parsed = new DOMParser().parseFromString(decodeURIComponent(url.slice(comma + 1)), 'image/svg+xml')
  return parsed.documentElement instanceof SVGSVGElement ? parsed : null
}

function retainedContentRoot(root: HTMLElement): HTMLElement {
  let content = root
  while (true) {
    const children = Array.from(content.children).filter(element => element.localName !== 'style')
    const child = children[0]
    if (children.length !== 1 || !(child instanceof HTMLElement) || !CONTAINERS.has(child.localName)) return content
    if (Array.from(content.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) return content
    content = child
  }
}

function capturedRoot(document: XMLDocument, root: HTMLElement): HTMLElement | null {
  const matches = Array.from(document.getElementsByTagNameNS(HTML_NAMESPACE, root.localName)).filter(element =>
    element.id === root.id && Array.from(root.classList).every(name => element.classList.contains(name)))
  return matches.length === 1 && matches[0] instanceof HTMLElement ? matches[0] : null
}

function retainedChain(root: HTMLElement, document: XMLDocument): Element[] | null {
  const chain: Element[] = [root]
  let child: Element = root
  let parent = child.parentElement
  while (parent) {
    const children = Array.from(parent.children).filter(element => element.localName !== 'style')
    if (children.length !== 1 || children[0] !== child) return null
    if (Array.from(parent.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) return null
    if (parent.namespaceURI === HTML_NAMESPACE && parent.localName !== 'div') return null
    if (parent.namespaceURI === SVG_NAMESPACE && !['svg', 'g', 'foreignObject'].includes(parent.localName)) return null
    if (parent.namespaceURI !== HTML_NAMESPACE && parent.namespaceURI !== SVG_NAMESPACE) return null
    chain.push(parent)
    if (parent === document.documentElement) return chain
    child = parent
    parent = child.parentElement
  }
  return null
}

function selectorSpecificity(selector: string): number | null {
  if (!/^[\w\s.*#>+~[\]="'|-]+$/.test(selector)) return null
  const attributes = selector.match(/\[[^\]]+\]/g) ?? []
  const withoutAttributes = selector.replace(/\[[^\]]+\]/g, '')
  const ids = withoutAttributes.match(/#[\w-]+/g) ?? []
  const classes = withoutAttributes.match(/\.[\w-]+/g) ?? []
  const types = withoutAttributes.replace(/[#.][\w-]+/g, '').match(/[a-zA-Z][\w-]*/g) ?? []
  if (attributes.length + classes.length >= 100 || types.length >= 100) return null
  return ids.length * 10000 + (attributes.length + classes.length) * 100 + types.length
}

function requiresCombinedPaint(style: CSSStyleDeclaration): boolean {
  const zIndex = style.getPropertyValue('z-index')
  return !ordinary(style.getPropertyValue('mix-blend-mode'), 'normal')
    || !ordinary(style.getPropertyValue('backdrop-filter'), 'none')
    || !ordinary(style.getPropertyValue('filter'), 'none')
    || !ordinary(zIndex, 'auto') && !/^\+?\d+$/.test(zIndex)
}

function matchRule(rule: CSSStyleRule, chain: Element[], matched: Map<Element, MatchedRule[]>, order: number): boolean | null {
  let keep = false
  for (const selector of rule.selectorText.split(',').map(value => value.trim())) {
    const pseudo = selector.indexOf('::')
    if (pseudo >= 0) {
      if (rule.style.content === 'none' && rule.style.display === 'none') continue
      const base = selector.slice(0, pseudo)
      if (selectorSpecificity(base) === null || chain.some(element => element.matches(base))) return null
      continue
    }
    const specificity = selectorSpecificity(selector)
    if (specificity === null) return null
    for (const node of chain) {
      if (!node.matches(selector)) continue
      matched.get(node)?.push({ rule, specificity, order })
      keep = true
    }
  }
  return keep
}

function selectedRules(document: XMLDocument, root: HTMLElement, chain: Element[]): Map<Element, MatchedRule[]> | null {
  const matched = new Map<Element, MatchedRule[]>()
  for (const element of chain) matched.set(element, [])
  let order = 0
  for (const element of document.querySelectorAll('[style]')) {
    const style = inlineStyle(element)
    if (!style || requiresCombinedPaint(style)) return null
  }
  for (const element of document.querySelectorAll('style')) {
    if (root.contains(element)) return null
    const text = element.textContent ?? ''
    if (/@import\b/i.test(text)) return null
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(text)
    const retained: string[] = []
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSFontFaceRule) continue
      if (!(rule instanceof CSSStyleRule) || rule.cssRules.length > 0 || requiresCombinedPaint(rule.style)) return null
      const keep = matchRule(rule, chain, matched, order)
      if (keep === null) return null
      if (keep) retained.push(rule.cssText)
      order++
    }
    element.textContent = retained.join('\n')
  }
  return matched
}

function resolvedStyle(element: Element, rules: readonly MatchedRule[]): CSSStyleDeclaration {
  const style = document.createElement('div').style
  const ordered = [...rules].sort((first, second) => first.specificity - second.specificity || first.order - second.order)
  style.cssText = ordered.map(entry => entry.rule.style.cssText).join(';') + ';' + (element.getAttribute('style') ?? '')
  return style
}

function independentPaint(style: CSSStyleDeclaration): boolean {
  return ordinary(style.opacity, '1') && !requiresCombinedPaint(style)
    && ordinary(style.getPropertyValue('mask-image'), 'none')
    && ordinary(style.getPropertyValue('-webkit-mask-box-image-source'), 'none')
    && ordinary(style.getPropertyValue('mask-border-source'), 'none')
    && ordinary(style.clipPath, 'none') && ordinary(style.isolation, 'auto')
    && ordinary(style.outlineStyle, 'none') && ordinary(style.borderImageSource, 'none')
    && ordinary(style.transform, 'none') && ordinary(style.translate, 'none')
    && ordinary(style.rotate, 'none') && ordinary(style.scale, 'none')
}

function ancestorIsUnpainted(style: CSSStyleDeclaration): boolean {
  return ordinary(style.backgroundImage, 'none')
    && ['', 'initial', 'transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor)
    && ordinary(style.boxShadow, 'none')
    && ['top', 'right', 'bottom', 'left'].every(side => ordinary(style.getPropertyValue(`border-${side}-style`), 'none'))
}

function fixedContainer(style: CSSStyleDeclaration): boolean {
  const formattingContext = ['flow-root', 'flex', 'grid'].includes(style.display)
    || style.display === 'block' && ['hidden', 'auto', 'scroll'].includes(style.overflowX)
  return formattingContext
    && ['min-width', 'min-height', 'max-width', 'max-height'].every(property => {
      const value = style.getPropertyValue(property)
      return ['', 'initial', 'auto', 'none'].includes(value) || /^\d+(?:\.\d+)?px$/.test(value)
    })
}

function rootPaintSupported(style: CSSStyleDeclaration): boolean {
  return [style.overflowX, style.overflowY].every(value => ordinary(value, 'visible') || value === 'hidden' || value === 'clip')
    && fixedContainer(style) && /^\d+(?:\.\d+)?px$/.test(style.width) && /^\d+(?:\.\d+)?px$/.test(style.height)
    && !/url\(|image\(|paint\(|cross-fade\(|var\(/.test(style.backgroundImage)
    && style.backgroundClip.split(',').every(value => ordinary(value.trim(), 'border-box') || value.trim() === 'padding-box')
    && style.backgroundAttachment.split(',').every(value => ordinary(value.trim(), 'scroll'))
    && ordinary(style.columnRuleStyle, 'none')
}

function chainIsIndependent(chain: Element[], retained: HTMLElement, rules: Map<Element, MatchedRule[]>): boolean {
  for (const element of chain) {
    const style = resolvedStyle(element, rules.get(element) ?? [])
    if (!independentPaint(style)) return false
    if (element === retained ? !rootPaintSupported(style) : !ancestorIsUnpainted(style)) return false
    if (element !== retained && element.namespaceURI === HTML_NAMESPACE
      && !['block', 'flow-root'].includes(style.display)) return false
    for (const property of ['opacity', 'filter', 'mask', 'clip-path']) {
      const value = element.getAttribute(property)
      if (value && value !== (property === 'opacity' ? '1' : 'none')) return false
    }
  }
  return true
}

function fullRootViewport(svg: SVGSVGElement, style: CSSStyleDeclaration): boolean {
  const box = svg.viewBox.baseVal
  const width = Number.parseFloat(style.width), height = Number.parseFloat(style.height)
  return style.boxSizing === 'border-box' && box.x === 0 && box.y === 0
    && box.width === width && box.height === height
    && Number(svg.getAttribute('width')) === width && Number(svg.getAttribute('height')) === height
}

function removeUnreferencedMetadata(document: XMLDocument, chain: Element[]): void {
  const css = [...Array.from(document.querySelectorAll('style'), element => element.textContent ?? ''),
    ...chain.map(element => element.getAttribute('style') ?? '')].join('\n').toLowerCase()
  if (/\\|attr\s*\(/.test(css)) return
  for (const element of chain) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if ((name === 'inert' || name.startsWith('aria-') || name.startsWith('data-')) && !css.includes(name)) {
        element.removeAttributeNode(attribute)
      }
    }
  }
}

function backgroundKey(document: XMLDocument, chain: Element[]): string {
  const css = [...Array.from(document.querySelectorAll('style'), element => element.textContent ?? ''),
    ...chain.map(element => element.getAttribute('style') ?? '')].join('\n')
  if (/\\|attr\s*\(/i.test(css)) return new XMLSerializer().serializeToString(document)
  const sheets = Array.from(document.querySelectorAll('style'), element => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(element.textContent ?? '')
    return { element, sheet }
  })
  const styles = chain.flatMap(element => {
    const style = inlineStyle(element)
    return style ? [style] : []
  })
  for (const { sheet } of sheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) throw new Error('munari: unsupported background key stylesheet')
      if (/\[[^\]]*\bstyle\b/i.test(rule.selectorText)) return new XMLSerializer().serializeToString(document)
      styles.push(rule.style)
    }
  }
  const normalBlend = styles.every(style => style.getPropertyValue('background-blend-mode').split(',')
    .every(value => ordinary(value.trim(), 'normal')))
  for (const style of styles) {
    for (const property of INACTIVE_MASK_PROPERTIES) style.removeProperty(property)
    if (normalBlend) style.removeProperty('background-blend-mode')
  }
  for (const { element, sheet } of sheets) {
    element.textContent = Array.from(sheet.cssRules).flatMap(rule =>
      rule instanceof CSSStyleRule && rule.style.length > 0 ? [rule.cssText] : []).join('\n')
  }
  removeUnreferencedMetadata(document, chain)
  return new XMLSerializer().serializeToString(document)
}

function backgroundSizeSupported(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width * height * 4 <= MAX_BACKGROUND_BYTES
}

function splitCapture(url: string, root: HTMLElement): { background: string; foreground: string; key: string; cssWidth: number; cssHeight: number } | null {
  const content = retainedContentRoot(root)
  if (!CONTAINERS.has(content.localName) || !('CSSStyleSheet' in globalThis)) return null
  const background = parseSvg(url)
  const svg = background?.documentElement
  if (!background || !(svg instanceof SVGSVGElement) || background.querySelectorAll('foreignObject').length !== 1) return null
  const retained = capturedRoot(background, content)
  const chain = retained ? retainedChain(retained, background) : null
  if (!retained || !chain) return null
  const foreground = background.cloneNode(true)
  if (!(foreground instanceof Document)) return null
  const front = capturedRoot(foreground, content)
  if (!front) return null
  const rules = selectedRules(background, retained, chain)
  if (!rules) return null
  if (!chainIsIndependent(chain, retained, rules)) return null
  if (!fullRootViewport(svg, resolvedStyle(retained, rules.get(retained) ?? []))) return null
  retained.replaceChildren()
  removeUnreferencedMetadata(background, chain)
  for (const [property, value] of FOREGROUND_OVERRIDES) {
    front.style.setProperty(property, value, 'important')
  }
  const serializer = new XMLSerializer()
  const backgroundSvg = serializer.serializeToString(background)
  const foregroundSvg = serializer.serializeToString(foreground)
  return { background: backgroundSvg, foreground: foregroundSvg, key: backgroundKey(background, chain),
    cssWidth: svg.viewBox.baseVal.width, cssHeight: svg.viewBox.baseVal.height }
}

async function decodeImage(url: string, width: number, height: number): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  await image.decode()
  image.width = width
  image.height = height
  return image
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

async function yieldCaptureTask(): Promise<void> {
  await (globalThis.scheduler?.yield?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0)))
}

export function createFullBackgroundCache(root: HTMLElement, target: HTMLCanvasElement, signal: AbortSignal) {
  let frame: BackgroundFrame | null = null
  let pending: HTMLCanvasElement | null = null
  let images = new WeakMap<HTMLImageElement, BackgroundFrame>()
  let generation = 0
  const release = () => {
    generation++
    if (pending) pending.width = pending.height = 0
    pending = null
    if (frame) frame.canvas.width = frame.canvas.height = 0
    frame = null
    images = new WeakMap()
  }
  signal.addEventListener('abort', release, { once: true })
  return {
    async decodeFull(url: string, width: number, height: number): Promise<HTMLImageElement> {
      await captureMemoryChosen()
      if (signal.aborted) return decodeImage(url, width, height)
      const context = captureContext(target)
      if (!context?.getContextAttributes().willReadFrequently) return decodeImage(url, width, height)
      if (!backgroundSizeSupported(width, height)) return decodeImage(url, width, height)
      const startedGeneration = generation
      try {
        await yieldCaptureTask()
        if (signal.aborted || generation !== startedGeneration) return decodeImage(url, width, height)
        const split = splitCapture(url, root)
        if (!split) return decodeImage(url, width, height)
        if (width * split.cssHeight !== height * split.cssWidth) return decodeImage(url, width, height)
        const key = `${width}x${height}:${split.key}`
        if (frame?.key === key) {
          const image = await decodeImage(svgUrl(split.foreground), width, height)
          if (signal.aborted || generation !== startedGeneration) return decodeImage(url, width, height)
          images.set(image, frame)
          return image
        }
        const backgroundCanvas = root.ownerDocument.createElement('canvas')
        backgroundCanvas.width = width
        backgroundCanvas.height = height
        pending = backgroundCanvas
        const backgroundImage = await decodeImage(svgUrl(split.background), width, height)
        const foregroundImage = await decodeImage(svgUrl(split.foreground), width, height)
        if (signal.aborted || generation !== startedGeneration) {
          backgroundCanvas.width = backgroundCanvas.height = 0
          return decodeImage(url, width, height)
        }
        const backgroundContext = captureContext(backgroundCanvas)
        if (!backgroundContext) throw new Error('munari: full background cache has no 2D context')
        backgroundContext.drawImage(backgroundImage, 0, 0, width, height)
        if (frame) frame.canvas.width = frame.canvas.height = 0
        frame = { key, canvas: backgroundCanvas }
        pending = null
        images.set(foregroundImage, frame)
        return foregroundImage
      } catch {
        if (pending) pending.width = pending.height = 0
        pending = null
        return decodeImage(url, width, height)
      }
    },
    paint(image: HTMLImageElement, context: CanvasRenderingContext2D): boolean {
      const background = images.get(image)
      if (!background || signal.aborted) return false
      context.drawImage(background.canvas, 0, 0, image.width, image.height)
      context.drawImage(image, 0, 0, image.width, image.height)
      images.delete(image)
      return true
    },
    release,
  }
}
