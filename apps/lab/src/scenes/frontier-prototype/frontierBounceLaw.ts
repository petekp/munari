// Lateral light-bounce stage geometry laws — pure drag clamping, pose presets,
// and CSS-pixel seam distances between the native DOM emitter and surrounding
// reflective Surface containers (supporting both 3-column desktop and stacked
// mobile/tablet inspector layouts).

export type BouncePosePreset = 'hug-nav' | 'center' | 'hug-inspector' | 'hug-top'

export interface BounceStageMetrics {
  readonly stageWidth: number
  readonly stageHeight: number
  readonly emitterWidth: number
  readonly emitterHeight: number
  /** Usable center-stage lane inside surrounding reflective chrome, in stage CSS px. */
  readonly laneLeft: number
  readonly laneTop: number
  readonly laneRight: number
  readonly laneBottom: number
  /** True when responsive layout stacks the Inspector below the center stage. */
  readonly inspectorBelow?: boolean
  /** Stage-local top/left edge of the Inspector slot when measured directly. */
  readonly inspectorEdgePx?: number
}

export interface BounceOffset {
  readonly x: number
  readonly y: number
}

export interface BounceOffsetBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

export interface BounceSeamGaps {
  readonly leftPx: number
  readonly topPx: number
  readonly rightPx: number
}

const SEAM_CLEARANCE_PX = 6

export function bounceOffsetBounds(m: BounceStageMetrics): BounceOffsetBounds {
  const laneW = Math.max(0, m.laneRight - m.laneLeft)
  const laneH = Math.max(0, m.laneBottom - m.laneTop)
  const halfSlackX = Math.max(0, (laneW - m.emitterWidth) * 0.5 - SEAM_CLEARANCE_PX)
  const halfSlackY = Math.max(0, (laneH - m.emitterHeight) * 0.5 - SEAM_CLEARANCE_PX)
  return {
    minX: halfSlackX === 0 ? 0 : -halfSlackX,
    maxX: halfSlackX,
    minY: halfSlackY === 0 ? 0 : -halfSlackY,
    maxY: halfSlackY,
  }
}

export function clampBounceOffset(offset: BounceOffset, m: BounceStageMetrics): BounceOffset {
  const b = bounceOffsetBounds(m)
  const rx = Math.max(b.minX, Math.min(b.maxX, offset.x))
  const ry = Math.max(b.minY, Math.min(b.maxY, offset.y))
  return {
    x: rx === 0 ? 0 : rx,
    y: ry === 0 ? 0 : ry,
  }
}

export function bouncePresetOffset(preset: BouncePosePreset, m: BounceStageMetrics): BounceOffset {
  const b = bounceOffsetBounds(m)
  if (preset === 'hug-nav') return { x: b.minX, y: 0 }
  if (preset === 'hug-inspector') {
    return m.inspectorBelow ? { x: 0, y: b.maxY } : { x: b.maxX, y: 0 }
  }
  if (preset === 'hug-top') return { x: 0, y: b.minY }
  return { x: 0, y: 0 }
}

export function computeBounceSeamGaps(offset: BounceOffset, m: BounceStageMetrics): BounceSeamGaps {
  const clamped = clampBounceOffset(offset, m)
  const laneCenterX = (m.laneLeft + m.laneRight) * 0.5
  const laneCenterY = (m.laneTop + m.laneBottom) * 0.5
  const emitLeft = laneCenterX + clamped.x - m.emitterWidth * 0.5
  const emitRight = emitLeft + m.emitterWidth
  const emitTop = laneCenterY + clamped.y - m.emitterHeight * 0.5
  const emitBottom = emitTop + m.emitterHeight

  const inspGap = m.inspectorBelow
    ? (m.inspectorEdgePx ?? m.laneBottom) - emitBottom
    : (m.inspectorEdgePx ?? m.laneRight) - emitRight

  return {
    leftPx: Math.max(0, Math.round(emitLeft - m.laneLeft)),
    topPx: Math.max(0, Math.round(emitTop - m.laneTop)),
    rightPx: Math.max(0, Math.round(inspGap)),
  }
}

export function measureBounceStageDom(
  stage: HTMLElement | null,
  lane: HTMLElement | null,
  emitter: HTMLElement | null,
  inspSlot: HTMLElement | null,
): BounceStageMetrics | null {
  if (!stage || !lane || !emitter) return null
  const sr = stage.getBoundingClientRect()
  const lr = lane.getBoundingClientRect()
  if (sr.width <= 0 || lr.width <= 0 || emitter.offsetWidth <= 0) return null
  const ir = inspSlot?.getBoundingClientRect() ?? null
  const inspectorBelow = ir ? ir.top >= lr.bottom - 4 : false
  const inspectorEdgePx = ir ? (inspectorBelow ? ir.top - sr.top : ir.left - sr.left) : undefined
  return {
    stageWidth: sr.width,
    stageHeight: sr.height,
    emitterWidth: emitter.offsetWidth,
    emitterHeight: emitter.offsetHeight,
    laneLeft: lr.left - sr.left,
    laneTop: lr.top - sr.top,
    laneRight: lr.right - sr.left,
    laneBottom: lr.bottom - sr.top,
    inspectorBelow,
    inspectorEdgePx,
  }
}
