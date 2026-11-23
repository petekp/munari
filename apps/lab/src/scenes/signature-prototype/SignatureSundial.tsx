// Prototype 01 (`SignatureSundial`): Dichroic Sundial & Live Caustic Shadows.
//
// An elevated clear-crystal `<Surface>` schedule card casts crisp diagonal shadows
// of its live `<input>` headline alongside jewel-toned stained-glass caustics
// directly across untouched, selectable native HTML architectural prose on the
// desk beside it — idling at `0 fps`.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { texture } from 'three/tsl'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceStatus,
  useCaptureSupport,
  useSurfaceTextureOf,
  type SurfaceHandle,
} from '@petepetrash/munari'
import { Button, Slider } from '../../components/system'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  useReducedMotion,
} from '../frontier-prototype/frontierStage'
import {
  createSundialCardMaterial,
  createSundialProjectionMaterial,
  createSundialUniforms,
  type SundialUniforms,
} from './signatureSundialNodes'
import './signatureSundial.css'

const noRaycast = () => {}

type DichroicColorId = 'emerald' | 'cobalt' | 'ruby' | 'amber'

interface DichroicSwatch {
  readonly id: DichroicColorId
  readonly label: string
  readonly paneBg: string
  readonly pipHex: string
  readonly accentHex: string
}

const SWATCHES: readonly DichroicSwatch[] = [
  {
    id: 'emerald',
    label: 'Emerald',
    paneBg: 'rgba(16, 185, 129, 0.56)',
    pipHex: '#10b981',
    accentHex: '#047857',
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    paneBg: 'rgba(37, 99, 235, 0.54)',
    pipHex: '#2563eb',
    accentHex: '#1d4ed8',
  },
  {
    id: 'ruby',
    label: 'Ruby',
    paneBg: 'rgba(225, 29, 72, 0.54)',
    pipHex: '#e11d48',
    accentHex: '#be123c',
  },
  {
    id: 'amber',
    label: 'Amber',
    paneBg: 'rgba(245, 158, 11, 0.58)',
    pipHex: '#f59e0b',
    accentHex: '#b45309',
  },
]

interface SundialPaneItem {
  readonly id: string
  readonly time: string
  readonly title: string
  readonly colorId: DichroicColorId
  readonly active: boolean
}

const INITIAL_PANES: readonly SundialPaneItem[] = [
  {
    id: 'heliodon',
    time: '09:00',
    title: 'Prism Calibration',
    colorId: 'emerald',
    active: true,
  },
  {
    id: 'facade',
    time: '13:30',
    title: 'Clerestory Glazing',
    colorId: 'cobalt',
    active: true,
  },
  {
    id: 'louver',
    time: '16:45',
    title: 'Louver Caustic Lock',
    colorId: 'ruby',
    active: true,
  },
]

const SCRATCH_SUN_DIR = new THREE.Vector3()
const SCRATCH_TINT = new THREE.Color()
const COLOR_NOON = new THREE.Color('#fffdf6')
const COLOR_AFTERNOON = new THREE.Color('#fff3d6')
const COLOR_GOLDEN = new THREE.Color('#ffe1aa')

function createTransparentPlaceholder(): THREE.DataTexture {
  const data = new Uint8Array([0, 0, 0, 0])
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function writeSolarOptics(
  angleDeg: number,
  cardRect: DOMRect,
  paperRect: DOMRect,
  uniforms: SundialUniforms,
): void {
  const tNorm = Math.max(0, Math.min(1, (angleDeg - 10) / 54))
  const stacked = paperRect.top > cardRect.bottom - 24

  let shiftX: number
  let shiftY: number
  if (stacked) {
    // Narrow stacked viewport: project downward from card onto `.ss-paper-sheet`
    const reachY = Math.max(240, paperRect.top - cardRect.top + 18)
    shiftX = (tNorm - 0.35) * 28
    shiftY = 96 + (reachY - 96) * (0.45 + tNorm * 0.55)
  } else {
    // Desktop side-by-side layout: sweep smoothly from grazing beside the card (`+12 deg`)
    // to projecting 100% of `SOLAR LAUNCH` cleanly across `.ss-paper-sheet` at `+56 deg`.
    const fullPaperReachX = Math.max(320, paperRect.left - cardRect.left + 18)
    shiftX = 56 + (fullPaperReachX - 56) * ((angleDeg - 10) / 46)
    shiftY = 14 + tNorm * 18
  }

  const rad = (angleDeg * Math.PI) / 180
  SCRATCH_SUN_DIR.set(-Math.sin(rad) * 0.85, 0.32, Math.cos(rad) * 0.65).normalize()

  if (tNorm < 0.5) {
    SCRATCH_TINT.copy(COLOR_NOON).lerp(COLOR_AFTERNOON, tNorm * 2)
  } else {
    SCRATCH_TINT.copy(COLOR_AFTERNOON).lerp(COLOR_GOLDEN, (tNorm - 0.5) * 2)
  }

  uniforms.sunShiftCss.value.set(shiftX, shiftY)
  uniforms.sunDir3d.value.copy(SCRATCH_SUN_DIR)
  uniforms.sunTint.value.copy(SCRATCH_TINT)
}

function useMeasuredSize(
  ref: { readonly current: HTMLElement | null },
  fallbackW: number,
  fallbackH: number,
): readonly [number, number] {
  const [size, setSize] = useState<readonly [number, number]>([fallbackW, fallbackH])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      const nw = Math.max(1, Math.round(r.width))
      const nh = Math.max(1, Math.round(r.height))
      setSize((prev) => (prev[0] === nw && prev[1] === nh ? prev : [nw, nh]))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return size
}

function SundialCardMaterialSlot({ uniforms }: { readonly uniforms: SundialUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createSundialCardMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function SundialScenePresenter({
  cardSurface,
  deskRef,
  slotRef,
  paperRef,
  solarAngleDeg,
  syncKey,
}: {
  readonly cardSurface: SurfaceHandle
  readonly deskRef: { readonly current: HTMLDivElement | null }
  readonly slotRef: { readonly current: HTMLDivElement | null }
  readonly paperRef: { readonly current: HTMLElement | null }
  readonly solarAngleDeg: number
  readonly syncKey: string
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const cardTex = useSurfaceTextureOf(cardSurface)
  const invalidate = useThree((s) => s.invalidate)

  const uniforms = useMemo(createSundialUniforms, [])
  const [placeholder] = useState(createTransparentPlaceholder)
  const [cardMap] = useState(() => texture(placeholder))
  const projectionMat = useMemo(
    () => createSundialProjectionMaterial(cardMap, uniforms),
    [cardMap, uniforms],
  )
  const [deskSize, setDeskSize] = useState<readonly [number, number]>([960, 520])
  const prevSyncRef = useRef(syncKey)

  useEffect(
    () => () => {
      projectionMat.dispose()
      placeholder.dispose()
    },
    [projectionMat, placeholder],
  )

  useEffect(() => {
    if (status.presentation === 'scene') return retainActiveSurface()
    return undefined
  }, [status.presentation])

  const syncLayoutAndSun = useCallback(() => {
    const desk = deskRef.current
    const slot = slotRef.current
    const paper = paperRef.current
    if (!desk || !slot || !paper) return
    const dr = desk.getBoundingClientRect()
    const sr = slot.getBoundingClientRect()
    const pr = paper.getBoundingClientRect()
    if (dr.width <= 0 || dr.height <= 0) return

    const dw = Math.round(dr.width)
    const dh = Math.round(dr.height)
    setDeskSize((prev) => (prev[0] === dw && prev[1] === dh ? prev : [dw, dh]))

    uniforms.deskSize.value.set(dr.width, dr.height)
    uniforms.cardRectCss.value.set(sr.left - dr.left, sr.top - dr.top, sr.width, sr.height)
    writeSolarOptics(solarAngleDeg, sr, pr, uniforms)
    invalidate()
  }, [deskRef, invalidate, paperRef, slotRef, solarAngleDeg, uniforms])

  useLayoutEffect(() => {
    syncLayoutAndSun()
    const desk = deskRef.current
    const slot = slotRef.current
    const paper = paperRef.current
    if (!desk || !slot || !paper) return undefined
    const ro = new ResizeObserver(syncLayoutAndSun)
    ro.observe(desk)
    ro.observe(slot)
    ro.observe(paper)
    return () => ro.disconnect()
  }, [deskRef, paperRef, slotRef, syncLayoutAndSun])

  useLayoutEffect(() => {
    if (cardTex) {
      cardMap.value = cardTex
      uniforms.cardReady.value = 1
      invalidate()
    }
  }, [cardMap, cardTex, invalidate, uniforms])

  useEffect(() => {
    if (prevSyncRef.current !== syncKey) {
      prevSyncRef.current = syncKey
      refreshSurface()
    }
  }, [refreshSurface, syncKey])

  return (
    <>
      <mesh
        position={[0, 0, -0.5]}
        scale={[deskSize[0], deskSize[1], 1]}
        renderOrder={1}
        raycast={noRaycast}
        material={projectionMat}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      <Surface.Mesh
        placement="match-dom"
        pointerRoute="auto"
        alpha="source"
        renderOrder={3}
        material={<SundialCardMaterialSlot uniforms={uniforms} />}
      />
    </>
  )
}

function SundialCardHtml({
  width,
  height,
  headline,
  panes,
  onChangeHeadline,
  onTogglePane,
  onCycleColor,
}: {
  readonly width: number
  readonly height: number
  readonly headline: string
  readonly panes: readonly SundialPaneItem[]
  readonly onChangeHeadline: (next: string) => void
  readonly onTogglePane: (id: string) => void
  readonly onCycleColor: (id: string) => void
}) {
  const activeCount = panes.filter((p) => p.active).length

  return (
    <div
      className="ss-card-root"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      <div className="ss-card-header">
        <div className="ss-card-kicker-row">
          <span>DICHROIC SCHEDULE</span>
          <span>{activeCount}/3 OPEN</span>
        </div>
        <input
          type="text"
          className="ss-headline-input"
          maxLength={15}
          aria-label="Projected glass headline"
          value={headline}
          onChange={(e) => onChangeHeadline(e.target.value)}
        />
      </div>

      <div className="ss-panes-list" role="group" aria-label="Dichroic schedule filters">
        {panes.map((pane) => {
          const swatch = SWATCHES.find((s) => s.id === pane.colorId) ?? SWATCHES[0]!
          return (
            <div
              key={pane.id}
              className="ss-pane-row"
              style={{
                background: pane.active ? swatch.paneBg : 'rgba(15, 23, 42, 0.04)',
              }}
            >
              <label className="ss-pane-label">
                <input
                  type="checkbox"
                  className="ss-pane-checkbox"
                  style={{ accentColor: swatch.accentHex }}
                  checked={pane.active}
                  onChange={() => onTogglePane(pane.id)}
                />
                <span className="ss-pane-text">
                  <span className="ss-pane-time">{pane.time}</span>
                  <span className="ss-pane-title">{pane.title}</span>
                </span>
              </label>

              <button
                type="button"
                className="ss-swatch-btn"
                aria-label={`Cycle ${pane.title} filter color (currently ${swatch.label})`}
                onClick={() => onCycleColor(pane.id)}
              >
                <span
                  className="ss-swatch-pip"
                  style={{ background: pane.active ? swatch.pipHex : '#94a3b8' }}
                />
                <span>{swatch.label}</span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const REVISIONS = ['REV A · DRAFT', 'REV B · VERIFIED', 'REV C · APPROVED'] as const

export function SignatureSundial() {
  const supported = useCaptureSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const cardSurface = useSurfaceHandle('sundial-card')

  const [solarAngleDeg, setSolarAngleDeg] = useState(56)
  const [headline, setHeadline] = useState('SOLAR LAUNCH')
  const [panes, setPanes] = useState<readonly SundialPaneItem[]>(INITIAL_PANES)
  const [revIdx, setRevIdx] = useState(0)

  const deskRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLElement>(null)
  const glideRef = useRef<number>(0)
  const [slotW, slotH] = useMeasuredSize(slotRef, 344, 276)

  const cancelGlide = useCallback(() => {
    if (glideRef.current) {
      cancelAnimationFrame(glideRef.current)
      glideRef.current = 0
    }
  }, [])

  useEffect(() => cancelGlide, [cancelGlide])

  const animateSunTo = useCallback(
    (targetAngle: number) => {
      cancelGlide()
      if (reducedMotion) {
        setSolarAngleDeg(targetAngle)
        return
      }
      const startAngle = solarAngleDeg
      const t0 = performance.now()
      const dur = 300
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur)
        const ease = 1 - Math.pow(1 - t, 3)
        setSolarAngleDeg(Math.round((startAngle + (targetAngle - startAngle) * ease) * 2) / 2)
        if (t < 1) glideRef.current = requestAnimationFrame(tick)
        else glideRef.current = 0
      }
      glideRef.current = requestAnimationFrame(tick)
    },
    [cancelGlide, reducedMotion, solarAngleDeg],
  )

  const togglePane = useCallback((id: string) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, active: !p.active } : p)))
  }, [])

  const cycleColor = useCallback((id: string) => {
    setPanes((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const idx = SWATCHES.findIndex((s) => s.id === p.colorId)
        const next = SWATCHES[(idx + 1) % SWATCHES.length]!
        return { ...p, colorId: next.id, active: true }
      }),
    )
  }, [])

  const syncKey = `${headline}:${panes.map((p) => `${p.id}-${p.colorId}-${p.active ? 1 : 0}`).join('|')}`

  return (
    <div className="sig-bench">
      <div className="sig-toolbar m-ui">
        <div className="sig-controls-group">
          <Button
            compact
            variant={solarAngleDeg < 24 ? 'solid' : 'outline'}
            onClick={() => animateSunTo(14)}
          >
            11:45 High (+14°)
          </Button>
          <Button
            compact
            variant={solarAngleDeg >= 24 && solarAngleDeg < 46 ? 'solid' : 'outline'}
            onClick={() => animateSunTo(36)}
          >
            14:30 Slant (+36°)
          </Button>
          <Button
            compact
            variant={solarAngleDeg >= 46 ? 'solid' : 'outline'}
            onClick={() => animateSunTo(56)}
          >
            16:45 Golden (+56°)
          </Button>
        </div>

        <div className="sig-slider-wrap">
          <Slider
            label="Solar slant"
            min={10}
            max={64}
            step={1}
            unit="°"
            value={Math.round(solarAngleDeg)}
            onChange={(v) => {
              cancelGlide()
              setSolarAngleDeg(v)
            }}
          />
        </div>
      </div>

      <div ref={deskRef} className="sig-stage-wrap ss-desk-stage">
        <div className="ss-desk-grid">
          <div className="ss-card-column">
            <div className="ss-elevation-tag">
              <span className="ss-sun-dot" aria-hidden="true" />
              <span>Elevated 48 mm · crystal gnomon</span>
            </div>

            <div
              ref={slotRef}
              className={supported ? 'ss-card-slot' : 'ss-card-slot ss-card-slot--degraded'}
            >
              <Surface.Root surface={cardSurface} canvasId={canvasId} inScene={supported}>
                <Surface.HTML size={[slotW, slotH]}>
                  <SundialCardHtml
                    width={slotW}
                    height={slotH}
                    headline={headline}
                    panes={panes}
                    onChangeHeadline={setHeadline}
                    onTogglePane={togglePane}
                    onCycleColor={cycleColor}
                  />
                </Surface.HTML>
                <Surface.Scene>
                  <SundialScenePresenter
                    cardSurface={cardSurface}
                    deskRef={deskRef}
                    slotRef={slotRef}
                    paperRef={paperRef}
                    solarAngleDeg={solarAngleDeg}
                    syncKey={syncKey}
                  />
                </Surface.Scene>
              </Surface.Root>
            </div>
          </div>

          <article ref={paperRef} className="ss-paper-sheet">
            <div className="ss-paper-top">
              <span className="ss-paper-kicker">DAYLIGHTING BRIEF · SHEET 04</span>
              <span className="ss-paper-rev">{REVISIONS[revIdx]}</span>
            </div>
            <h2 className="ss-paper-h2">Clerestory Transmission &amp; Shadow Study</h2>
            <p className="ss-paper-prose">
              Notice the projected headline shadow and stained-glass caustics falling directly
              across this specification sheet. Only the crystal schedule card on the left is
              promoted to a GPU Surface; this editorial column stays ordinary page HTML.
            </p>
            <p className="ss-paper-prose">
              Rename the glass headline to watch its shadow letters update character-by-character,
              uncheck a filter row to extinguish its beam, or drag to select this native text right
              through the refracted light.
            </p>
            <div className="ss-paper-footer">
              <button
                type="button"
                className="ss-paper-stamp-btn"
                onClick={() => setRevIdx((i) => (i + 1) % REVISIONS.length)}
              >
                Cycle Sheet Stamp ↵
              </button>
              <span className="ss-paper-note">Native text selection active</span>
            </div>
          </article>
        </div>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: true, depth: false }}
            onCreated={({ gl }) => gl.setClearAlpha(0)}
            className="sig-overlay-canvas"
          >
            <FrontierPixelCamera />
            <FrontierCanvasTelemetry />
          </SurfaceCanvas>
        )}
      </div>
    </div>
  )
}
