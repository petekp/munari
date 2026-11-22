// Why Munari live stage — on-demand framed demo runner with off-screen auto-park.
//
// The law: at most one live 3D demo iframe mounts on the walkthrough page at a
// time, and scrolling far past an active stage parks it back to its poster so
// off-screen WebGPU contexts never spin in the background.
//
// Ownership: `Why.tsx` owns which section's stage is active; this module owns
// responsive scaling, engine mode (`auto` vs `snapdom`), and visibility parking.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Ruler, TextButton } from '../../components/system'
import { sceneUrl, type CaptureMode } from '../../captureMode'
import type { RelatedSceneLink } from './whyData'

const DESKTOP_WIDTH = 1100
const PHONE_WIDTH = 720
const NARROW_STAGE = 560

export interface WhyLiveStageProps {
  readonly demoId: string
  readonly title: string
  readonly thumb: string
  readonly instruction: string
  readonly active: boolean
  readonly allowEngineSwitch?: boolean
  readonly relatedScenes: readonly RelatedSceneLink[]
  readonly onActivate: () => void
  readonly onPark: () => void
}

export function WhyLiveStage({
  demoId,
  title,
  thumb,
  instruction,
  active,
  allowEngineSwitch = false,
  relatedScenes,
  onActivate,
  onPark,
}: WhyLiveStageProps) {
  const containerRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [loadedKey, setLoadedKey] = useState('')
  const [engineMode, setEngineMode] = useState<CaptureMode>('auto')

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const observer = new ResizeObserver(() => setWidth(panel.clientWidth))
    observer.observe(panel)
    setWidth(panel.clientWidth)
    return () => observer.disconnect()
  }, [active])

  // Pause and park the running WebGPU iframe if the browser skips rendering
  // this off-screen section, with an IntersectionObserver fallback.
  useEffect(() => {
    const node = containerRef.current
    if (!active || !node) return
    const target = node.closest('.why-walk-section') ?? node
    const onAutoState = (event: Event) => {
      if ('skipped' in event && event.skipped === true) onPark()
    }
    target.addEventListener('contentvisibilityautostatechange', onAutoState)
    const supportsContentVisibility = 'contentVisibility' in document.documentElement.style
    let observer: IntersectionObserver | null = null
    if (!supportsContentVisibility) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) onPark()
          }
        },
        { rootMargin: '300px' },
      )
      observer.observe(target)
    }
    return () => {
      target.removeEventListener('contentvisibilityautostatechange', onAutoState)
      observer?.disconnect()
    }
  }, [active, onPark])

  const narrow = width > 0 && width < NARROW_STAGE
  const frameWidth = Math.max(width, narrow ? PHONE_WIDTH : DESKTOP_WIDTH)
  const scale = frameWidth > 0 && width > 0 ? width / frameWidth : 1
  const stageHeight = width > 0 ? Math.round(Math.min(width * (narrow ? 0.78 : 0.56), 540)) : 380
  const frameHeight = Math.round(stageHeight / scale)
  const frameKey = `${demoId}:${engineMode}`

  return (
    <figure ref={containerRef} className="why-stage" aria-label={`${title} live demo`}>
      <div ref={panelRef} className="m-stage why-stage-panel" style={{ height: stageHeight }}>
        <img className="why-stage-poster" src={thumb} alt="" loading="lazy" />
        {!active && (
          <div className="why-stage-overlay">
            <Button onClick={onActivate}>Run {title} live</Button>
          </div>
        )}
        {active && width > 0 && (
          <iframe
            key={frameKey}
            className="why-stage-frame"
            title={`${title} live demo`}
            src={sceneUrl(demoId, { framed: true, bare: true, capture: engineMode })}
            data-loaded={loadedKey === frameKey || undefined}
            onLoad={() => setLoadedKey(frameKey)}
            style={{ width: frameWidth, height: frameHeight, transform: `scale(${scale})` }}
          />
        )}
      </div>

      <div className="why-stage-caption">
        <p className="m-ui">
          <b>{title}.</b> {instruction}
        </p>
        <div className="why-stage-actions m-ui">
          {allowEngineSwitch && (
            <span className="why-engine-switch" role="group" aria-label="Capture engine">
              <Button
                variant={engineMode === 'auto' ? 'solid' : 'outline'}
                compact
                onClick={() => {
                  setEngineMode('auto')
                  if (!active) onActivate()
                }}
              >
                Auto engine
              </Button>
              <Button
                variant={engineMode === 'snapdom' ? 'solid' : 'outline'}
                compact
                onClick={() => {
                  setEngineMode('snapdom')
                  if (!active) onActivate()
                }}
              >
                Force snapDOM
              </Button>
            </span>
          )}
          {active && <TextButton onClick={onPark}>Stop live demo</TextButton>}
          <a className="m-link" href={sceneUrl(demoId, { capture: engineMode })}>
            Open full page
          </a>
        </div>
      </div>
      <Ruler />
      {relatedScenes.length > 0 && (
        <div className="why-related m-small m-quiet">
          <span>More scenes for this capability:</span>
          {relatedScenes.map((scene) => (
            <a key={scene.id} className="m-link" href={sceneUrl(scene.id)}>
              {scene.label}
            </a>
          ))}
        </div>
      )}
    </figure>
  )
}
