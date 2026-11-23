// Plume's plain layout snapshot — what the gate reads to compare the native
// field, the visible mirror and the parked capture.
//
// The law: the three copies share one layout box and one type rule, the
// mirror sits exactly over the native field, and the capture differs from
// the field on screen by no more than float rounding.
//
// Sizes come from ResizeObserver's border box, the layout size. On
// 2026-11-23 the gate failed on Chrome 157.0.8103.78 and 158.0.8127.36 and
// passed on 156.0.8078.47 at the same commit: after drawElementImage, a
// canvas child's getBoundingClientRect reads one float32 step off its layout
// size. The parked 1000px capture, drawn into a 3400px backing store, reads
// 999.9999389648438px while its offsetWidth, computed width and observed
// border box are 1000 and its canvas's rect is 1000. A bare canvas with a
// 1000px child shows the same value at backing width 3400 only.
//
// Ownership: this module reads the page. run.mjs owns the assertions and the
// browser.

// How far the parked capture's on-screen size may sit from the native
// field's. Chrome 157 and 158 report a drawn canvas child's rect one float32
// step off at 1000px, 6.1e-5px. A layout unit is 1/64px, so this bound admits
// that rounding and no layout error. The layout boxes are compared exactly.
const SCREEN_ROUNDING = 1e-3

export function copiesMatch(layout, captured) {
  const mirrorMatches = layout.input.align === 'center' && layout.input.family.toLowerCase().includes('archivo') &&
    JSON.stringify(layout.input) === JSON.stringify(layout.mirror) &&
    JSON.stringify(layout.inputScreen) === JSON.stringify(layout.mirrorScreen)
  if (!captured) return mirrorMatches
  return mirrorMatches && JSON.stringify(layout.input) === JSON.stringify(layout.capture) &&
    Math.abs(layout.captureScreen[2] - layout.inputScreen[2]) <= SCREEN_ROUNDING &&
    Math.abs(layout.captureScreen[3] - layout.inputScreen[3]) <= SCREEN_ROUNDING
}

export async function readPlainLayout(page, captured) {
  await page.waitForFunction((captured) => {
    const input = document.querySelector('textarea.plume-input')
    const copy = document.querySelector('.plume-capture')
    if (!input || (captured && !copy)) return false
    if (!captured) return true
    const native = input.getBoundingClientRect()
    const source = copy.getBoundingClientRect()
    return Math.abs(native.width - source.width) < 1 && Math.abs(native.height - source.height) < 1
  }, { timeout: 5000 }, captured)
  const layout = await page.evaluate(async () => {
    const page = document.querySelector('.plume-page')
    const work = document.querySelector('.plume-work')
    const sheet = document.querySelector('.plume-sheet')
    const measure = document.querySelector('.plume-measure')
    const input = document.querySelector('textarea.plume-input')
    const mirror = document.querySelector('.plume-mirror')
    const capture = document.querySelector('.plume-capture')
    // The rest of the snapshot is read in the observer's task, so every
    // field describes one frame.
    const boxes = await new Promise((resolve) => {
      const elements = [input, mirror, capture].filter(Boolean)
      const found = new Map()
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const [box] = entry.borderBoxSize
          found.set(entry.target, { width: box.inlineSize, height: box.blockSize })
        }
        if (found.size === elements.length) finish()
      })
      // A zero-sized element is never reported. Its null size then fails
      // the comparison with the JSON dump instead of hanging the gate.
      const timer = setTimeout(() => finish(), 1000)
      function finish() {
        observer.disconnect()
        clearTimeout(timer)
        resolve(found)
      }
      for (const element of elements) observer.observe(element)
    })
    const rect = work.getBoundingClientRect()
    const pageStyle = getComputedStyle(page)
    const sheetStyle = getComputedStyle(sheet)
    const typography = (element) => {
      if (!element) return null
      const style = getComputedStyle(element)
      return {
        family: style.fontFamily,
        size: style.fontSize,
        weight: style.fontWeight,
        leading: style.lineHeight,
        spacing: style.letterSpacing,
        align: style.textAlign,
        padding: style.padding,
        ...boxes.get(element) ?? { width: null, height: null },
      }
    }
    const screenBox = (element) => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return [box.x, box.y, box.width, box.height]
    }
    const flowOffset = (selector) => {
      const flow = document.querySelector(selector)
      return flow ? new DOMMatrixReadOnly(getComputedStyle(flow).transform).m42 : null
    }
    return {
      width: innerWidth,
      height: innerHeight,
      x: rect.left,
      y: rect.top,
      workWidth: rect.width,
      workHeight: rect.height,
      centerError: Math.hypot(rect.left + rect.width / 2 - innerWidth / 2,
        rect.top + rect.height / 2 - innerHeight / 2),
      background: pageStyle.backgroundColor,
      backgroundImage: pageStyle.backgroundImage,
      sheetBackground: sheetStyle.backgroundColor,
      sheetImage: sheetStyle.backgroundImage,
      border: [sheetStyle.borderTopWidth, sheetStyle.borderRightWidth,
        sheetStyle.borderBottomWidth, sheetStyle.borderLeftWidth],
      shadow: sheetStyle.boxShadow,
      measureHeight: measure?.getBoundingClientRect().height,
      measureHidden: measure ? getComputedStyle(measure).visibility === 'hidden' : false,
      input: typography(input),
      mirror: typography(mirror),
      capture: typography(capture),
      inputScreen: screenBox(input),
      mirrorScreen: screenBox(mirror),
      captureScreen: screenBox(capture),
      scrollTop: input.scrollTop,
      scrollHeight: input.scrollHeight,
      clientHeight: input.clientHeight,
      mirrorOffset: flowOffset('.plume-mirror .plume-copy__flow'),
      captureOffset: flowOffset('.plume-capture .plume-copy__flow'),
      pageScroll: scrollY,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      oldChrome: [...document.querySelectorAll('.plume-intro, .plume-rule, .plume-sheet__meta, .plume-actions, .plume-status')]
        .filter((element) => !element.closest('[data-plume-controls]')).length,
      open: !document.querySelector('[data-plume-controls]').hidden,
    }
  })
  return layout
}
