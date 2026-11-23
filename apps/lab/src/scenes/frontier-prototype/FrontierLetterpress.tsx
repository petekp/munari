// Variant B: Museum-grade letterpress & hot-stamped foil on in-place editable HTML.
//
// Click directly into the headline on the cotton plate to edit it live, or drag to
// select any run of body copy. A two-scale Sobel heightfield shades 24k gold foil
// on the display zone and dense carbon letterpress ink on body prose at 0 fps idle.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { texture } from 'three/tsl'
import {
  SurfaceCanvas,
  useCaptureFrame,
  useElementCapture,
  useCaptureSupport,
  type ElementCapture,
} from '@petepetrash/munari'
import { Button, Tag } from '../../components/system'
import {
  createLetterpressMaterial,
  createLetterpressUniforms,
  finishIndex,
  type PressFinishId,
} from './frontierLetterpressNodes'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  createPaperPlaceholderTexture,
  retainActiveSurface,
  stageBoxOf,
  useReducedMotion,
} from './frontierStage'

interface FinishMeta {
  readonly id: PressFinishId
  readonly label: string
}

const FINISHES: readonly FinishMeta[] = [
  { id: 'gold-foil', label: '24k gold leaf' },
  { id: 'cotton-letterpress', label: 'Vermilion & carbon press' },
  { id: 'holo-diffraction', label: 'Holographic foil' },
  { id: 'titanium-etch', label: 'Brushed titanium' },
]

function LetterpressOverlayMesh({
  capture,
  sheetRef,
  finish,
  biteDepth,
  lightRef,
  introSweepRef,
  wakeRef,
}: {
  readonly capture: ElementCapture
  readonly sheetRef: { readonly current: HTMLDivElement | null }
  readonly finish: PressFinishId
  readonly biteDepth: number
  readonly lightRef: { readonly current: { u: number; v: number; z: number } }
  readonly introSweepRef: { current: number }
  readonly wakeRef: { current: (() => void) | null }
}) {
  const frames = useCaptureFrame(capture)
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const meshRef = useRef<THREE.Mesh>(null)

  const [blank] = useState(createPaperPlaceholderTexture)
  const [glyphMap] = useState(() => texture(blank))
  const uniforms = useMemo(createLetterpressUniforms, [])
  const material = useMemo(() => createLetterpressMaterial(glyphMap, uniforms), [glyphMap, uniforms])

  useEffect(() => {
    wakeRef.current = () => invalidate()
    const release = retainActiveSurface()
    return () => {
      wakeRef.current = null
      release()
      material.dispose()
      blank.dispose()
    }
  }, [invalidate, wakeRef, material, blank])

  useEffect(() => {
    uniforms.finishMode.value = finishIndex(finish)
    uniforms.biteDepth.value = biteDepth
    invalidate()
  }, [finish, biteDepth, uniforms, invalidate])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    const box = stageBoxOf(sheetRef.current, gl.domElement)
    const latest = frames.get()
    if (!mesh || !box || !latest) {
      if (mesh) mesh.visible = false
      return
    }
    mesh.visible = true
    glyphMap.value = latest.texture
    mesh.position.set(box.x, box.y, 0)
    mesh.scale.set(box.w, box.h, 1)
    uniforms.sheetSize.value.set(box.w, box.h)

    if (introSweepRef.current < 1) {
      introSweepRef.current = Math.min(1, introSweepRef.current + Math.max(0.016, Math.min(delta, 0.05)) * 2.1)
      const t = introSweepRef.current
      const eased = 1 - Math.pow(1 - t, 3)
      lightRef.current.u = 0.10 + eased * 0.22
      lightRef.current.v = 0.28 - eased * 0.06
      if (introSweepRef.current < 1) invalidate()
    }

    uniforms.lightPosCss.value.set(
      lightRef.current.u * box.w,
      lightRef.current.v * box.h,
      lightRef.current.z,
    )
  })

  return (
    <mesh ref={meshRef} visible={false} material={material}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

export function FrontierLetterpress() {
  const supported = useCaptureSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const pressCapture = useElementCapture()

  const [finish, setFinish] = useState<PressFinishId>('gold-foil')
  const [deepBite, setDeepBite] = useState(true)
  const [lampUi, setLampUi] = useState({ u: 0.32, v: 0.22 })

  const sheetRef = useRef<HTMLDivElement>(null)
  const headlineRef = useRef<HTMLHeadingElement>(null)
  const lightRef = useRef({ u: 0.32, v: 0.22, z: 155 })
  const introSweepRef = useRef(reducedMotion ? 1 : 0)
  const wakeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (reducedMotion) introSweepRef.current = 1
  }, [reducedMotion])

  const refreshCapture = useCallback(() => {
    requestAnimationFrame(() => {
      pressCapture.refresh()
      wakeRef.current?.()
    })
  }, [pressCapture])

  const onSheetPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion) return
    const el = sheetRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    introSweepRef.current = 1
    const u = Math.max(0.04, Math.min(0.96, (event.clientX - r.left) / r.width))
    const v = Math.max(0.06, Math.min(0.94, (event.clientY - r.top) / r.height))
    lightRef.current = { u, v, z: 150 }
    wakeRef.current?.()
  }

  const setPresetLight = (u: number, v: number, z: number) => {
    introSweepRef.current = 1
    lightRef.current = { u, v, z }
    setLampUi({ u, v })
    wakeRef.current?.()
  }

  return (
    <div className="frontier-bench">
      <div className="frontier-toolbar m-ui">
        <div className="frontier-controls-group" role="group" aria-label="Press stock and foil finish">
          {FINISHES.map((item) => (
            <Button
              key={item.id}
              compact
              variant={finish === item.id ? 'solid' : 'outline'}
              onClick={() => setFinish(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="frontier-controls-group" role="group" aria-label="Raking light and bite">
          <Button compact variant="outline" onClick={() => setPresetLight(0.14, 0.20, 140)}>
            Grazing left
          </Button>
          <Button compact variant="outline" onClick={() => setPresetLight(0.50, 0.26, 210)}>
            Center lamp
          </Button>
          <Button compact variant="outline" onClick={() => setPresetLight(0.86, 0.20, 140)}>
            Grazing right
          </Button>
          <Button compact variant={deepBite ? 'solid' : 'outline'} onClick={() => setDeepBite((v) => !v)}>
            {deepBite ? 'Deep platen bite' : 'Light kiss'}
          </Button>
          <Button
            compact
            variant="outline"
            onClick={() => {
              const el = headlineRef.current
              if (!el) return
              el.focus()
              const range = document.createRange()
              range.selectNodeContents(el)
              range.collapse(false)
              const sel = window.getSelection()
              sel?.removeAllRanges()
              sel?.addRange(range)
            }}
          >
            Edit headline in place
          </Button>
        </div>
      </div>

      <div
        className={`frontier-stage-wrap frontier-press-stage frontier-press-stage--${finish}`}
        onPointerMove={onSheetPointerMove}
      >
        <div className="frontier-press-card-frame">
          <span
            className="frontier-lamp-pip frontier-lamp-pip--sheet"
            style={{ left: `${lampUi.u * 100}%`, top: `${lampUi.v * 100}%` }}
            aria-hidden="true"
          />

          <div ref={sheetRef} className="frontier-press-sheet-slot">
            <div ref={pressCapture.ref} className="frontier-press-capture">
              <div className="frontier-press-toprow frontier-foil-zone">
                <span>Officina tipografica · Milano</span>
                <span aria-hidden="true">✦ Plate n° 04 · 600 gsm cotton rag ✦</span>
              </div>

              <h2
                ref={headlineRef}
                className="frontier-press-headline frontier-foil-zone"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                aria-label="Editable foil-stamped headline"
                onInput={refreshCapture}
              >
                Tactile Ink, Native Text.
              </h2>

              <p className="frontier-press-body">
                Click the stamped headline above to type directly into 24k gold foil, or drag across this paragraph to
                test real browser selection and copy. A two-scale Sobel heightfield indents surrounding cotton fibers
                while keeping body copy in dense, high-contrast carbon ink.
              </p>

              <div className="frontier-press-foot frontier-foil-zone">
                <span>Bruno Munari · Edition 014 / 100</span>
                <span>In-place DOM · 0 fps when still</span>
              </div>
            </div>
          </div>
        </div>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: false, depth: false }}
            onCreated={({ gl }) => gl.setClearAlpha(0)}
            className="frontier-overlay-canvas frontier-overlay-canvas--passthrough"
          >
            <FrontierPixelCamera />
            <FrontierCanvasTelemetry />
            <LetterpressOverlayMesh
              capture={pressCapture}
              sheetRef={sheetRef}
              finish={finish}
              biteDepth={deepBite ? 3.2 : 1.7}
              lightRef={lightRef}
              introSweepRef={introSweepRef}
              wakeRef={wakeRef}
            />
          </SurfaceCanvas>
        )}

        <div className="frontier-press-hint m-small">
          <Tag>Click headline to edit live · Drag across prose to test native selection · Move cursor to sweep light</Tag>
        </div>
      </div>
    </div>
  )
}
