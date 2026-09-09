// Plume — a native writing field whose ink leaves as weather.
//
// The law: the textarea owns value, caret, selection, focus and scroll. A
// plain DOM mirror owns readable pixels. A separate parked mirror supplies
// immutable ink to one WebGL cloud after a word's hold expires. No renderer
// is asked to imitate text editing.
//
// The fault behind the three layers, measured in docs/authoring.md: a focused
// field repaints its source about twice per second from caret blink alone.
// Keeping the field outside the capture preserves idle paint and prevents a
// shader from becoming the accessibility tree. Ownership: this file owns the
// React wiring and DOM. plumeLaw owns unit time, plumeCloud owns grains, and
// plumeShaders owns their motion.

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  CaptureContent,
  useCaptureHandle,
  useCaptureFrame,
  type CaptureHandle,
  SurfaceCanvas,
  useSurfaceSupport,
  type SourceUvRect,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { textureSlot } from '../../lib/uniforms'
import { buildPlumeGrid, stampPlumeReleases, type PlumeGrid } from './plumeCloud'
import {
  nextTimelineBoundary,
  rearmUnits,
  reconcileUnits,
  unitPhase,
  type TimedUnit,
  type UnitPhase,
} from './plumeLaw'
import { PLUME_FRAG, PLUME_VERT } from './plumeShaders'
import { PlumeTweaks } from './plumeTweaks'
import {
  defaultPlumeEffects,
  plumeTuning,
  type PlumeEffects,
  type PlumeTuning,
} from './plumeTuning'
import './plume.css'

const FOV = 42
const OPENING = 'Some thoughts only need\nenough time to become weather.'
const FONT_FAMILIES = {
  serif: 'var(--display)',
  sans: 'var(--body)',
  mono: 'var(--data)',
} satisfies Readonly<Record<PlumeTuning['fontFamily'], string>>

type PlumeStyle = React.CSSProperties & { [key: `--plume-${string}`]: string | number }

// A new letter shape needs new anchor keys. Reusing a painted key after a
// font edit would let that old receipt release ink the new texture never drew.
const CAPTURE_TUNING_KEYS = [
  'fontFamily', 'typeScale', 'fontWeight', 'lineHeight', 'letterSpacing', 'textWidth', 'inkColor',
  // Switching between words and characters changes how many anchors exist
  // and what each one covers, so every painted receipt has to be reissued.
  'releaseUnit',
] as const satisfies readonly (keyof PlumeTuning)[]
const REPLAY_TUNING_KEYS = [
  'holdMs', 'durationMs', 'reducedDurationMs', 'staggerMs', 'pitch',
] as const satisfies readonly (keyof PlumeTuning)[]

interface TextLedger {
  readonly value: string
  readonly units: readonly TimedUnit[]
  readonly nextId: number
}

interface StageBox {
  readonly width: number
  readonly height: number
  readonly worldX: number
  readonly worldY: number
}

interface PlumeCopyProps {
  readonly value: string
  readonly units: readonly TimedUnit[]
  readonly scrollTop: number
  readonly capture: boolean
  readonly phaseOf: (unit: TimedUnit) => UnitPhase
  readonly typeStyle: PlumeStyle
}

function PlumeCopy({ value, units, scrollTop, capture, phaseOf, typeStyle }: PlumeCopyProps) {
  const pieces: React.ReactNode[] = []
  let cursor = 0
  for (const unit of units) {
    if (unit.start > cursor) {
      pieces.push(
        <Fragment key={`space-${cursor}`}>
          {value.slice(cursor, unit.start)}
        </Fragment>,
      )
    }
    pieces.push(
      <span
        key={unit.id}
        className="plume-word"
        data-munari-anchor={capture ? unit.id : undefined}
        data-phase={capture ? undefined : phaseOf(unit)}
      >
        {unit.text}
      </span>,
    )
    cursor = unit.end
  }
  if (cursor < value.length) {
    pieces.push(<Fragment key={`space-${cursor}`}>{value.slice(cursor)}</Fragment>)
  }

  return (
    <div className={capture ? 'plume-capture plume-copy' : 'plume-mirror plume-copy'} style={typeStyle} aria-hidden>
      <div className="plume-copy__flow" style={{ transform: `translateY(${-scrollTop}px)` }}>
        {pieces}
      </div>
    </div>
  )
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const change = () => setReduced(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return reduced
}

function useTimeline(units: readonly TimedUnit[], durationMs: number): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const boundary = nextTimelineBoundary(units, now, durationMs)
    if (boundary === null) return
    const wait = Math.max(0, boundary - performance.now() + 8)
    const timer = window.setTimeout(() => setNow(performance.now()), wait)
    return () => window.clearTimeout(timer)
  }, [units, now, durationMs])
  return now
}

function useStageBox(ref: React.RefObject<HTMLElement | null>): StageBox | null {
  const [box, setBox] = useState<StageBox | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let alive = true
    const measure = () => {
      if (!alive) return
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const next = {
        width: rect.width,
        height: rect.height,
        worldX: rect.left + rect.width / 2 - window.innerWidth / 2,
        worldY: window.innerHeight / 2 - (rect.top + rect.height / 2),
      }
      setBox((current) => current && current.width === next.width && current.height === next.height &&
        current.worldX === next.worldX && current.worldY === next.worldY ? current : next)
    }
    measure()
    void document.fonts.ready.then(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      alive = false
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])
  return box
}

function PlumeCamera() {
  // SAFETY: SurfaceCanvas receives a perspective camera below. r3f exposes
  // the common Camera base, so the authored camera kind is narrowed here.
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  const setDpr = useThree((state) => state.setDpr)
  useEffect(() => {
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.updateProjectionMatrix()
  }, [camera, size.height])
  useFrame(() => {
    const next = Math.max(1, window.devicePixelRatio)
    if (Math.abs(next - dpr) > 1e-3) setDpr(next)
  })
  return null
}

/** A scene-local animation claim for a demand canvas.
 *
 * SurfaceCanvas claims frames for capture and handoff work. Particle time is
 * scene work, so the scene invalidates the next frame until its last word is
 * gone. Keeping the Canvas prop at `demand` avoids a prop-change race across
 * r3f's separate reconciler: the active child arrives, invalidates once, and
 * every frame schedules its successor. */
function PlumeFrames({ active }: { readonly active: boolean }) {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    if (active) invalidate()
  }, [active, invalidate])
  useFrame(() => {
    if (active) invalidate()
  })
  return null
}

interface PlumeMaterialProps {
  readonly texture: THREE.Texture
  readonly grid: PlumeGrid
  readonly durationMs: number
  readonly reduced: boolean
  readonly effects: PlumeEffects
  readonly tuning: PlumeTuning
  readonly draft: React.RefObject<THREE.Vector2>
}

function PlumeMaterial({ texture, grid, durationMs, reduced, effects, tuning, draft }: PlumeMaterialProps) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const invalidate = useThree((state) => state.invalidate)
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uTime: { value: 0 },
      uDuration: { value: plumeTuning.durationMs / 1000 },
      uStagger: { value: plumeTuning.staggerMs / 1000 },
      uRise: { value: plumeTuning.rise },
      uSpread: { value: plumeTuning.spread },
      uDepth: { value: plumeTuning.depth },
      uTurbulence: { value: plumeTuning.turbulence },
      uBillow: { value: plumeTuning.billow },
      uShading: { value: plumeTuning.shading },
      uDepthFog: { value: plumeTuning.depthFog },
      uTurbulenceSpeed: { value: plumeTuning.turbulenceSpeed },
      uDraftStrength: { value: plumeTuning.draftStrength },
      uParticleSize: { value: plumeTuning.particleSize },
      uSizeVariation: { value: plumeTuning.sizeVariation },
      uParticleGrowth: { value: plumeTuning.particleGrowth },
      uParticleOpacity: { value: plumeTuning.particleOpacity },
      uParticleSoftness: { value: plumeTuning.particleSoftness },
      uLifetimeVariation: { value: plumeTuning.lifetimeVariation },
      uSparkAmount: { value: plumeTuning.sparkAmount },
      uTint: { value: plumeTuning.tint },
      uWisps: { value: 1 },
      uDraftOn: { value: 1 },
      uReduced: { value: 0 },
      uDraft: { value: new THREE.Vector2() },
      uGrain: { value: new THREE.Vector2(grid.cellWidth, grid.cellHeight) },
      uPitchUv: { value: new THREE.Vector2(1 / grid.cols, 1 / grid.rows) },
      uSmoke: { value: new THREE.Color(plumeTuning.particleColor) },
      uEmber: { value: new THREE.Color(plumeTuning.sparkColor) },
      uPaper: { value: new THREE.Color(plumeTuning.backgroundColor) },
      uEmbers: { value: 1 },
    }),
    [grid.cellHeight, grid.cellWidth, grid.cols, grid.rows],
  )

  // Sliders update the existing material. They must also request one frame
  // when the cloud is at rest; otherwise a demand canvas can show old values.
  useLayoutEffect(() => {
    const owned = material.current?.uniforms
    if (!owned) return
    owned.tMap!.value = texture
    owned.uDuration!.value = durationMs / 1000
    owned.uStagger!.value = tuning.staggerMs / 1000
    owned.uRise!.value = tuning.rise
    owned.uSpread!.value = tuning.spread
    owned.uDepth!.value = tuning.depth
    owned.uTurbulence!.value = tuning.turbulence
    owned.uBillow!.value = tuning.billow
    owned.uShading!.value = tuning.shading
    owned.uDepthFog!.value = tuning.depthFog
    owned.uTurbulenceSpeed!.value = tuning.turbulenceSpeed
    owned.uDraftStrength!.value = tuning.draftStrength
    owned.uParticleSize!.value = tuning.particleSize
    owned.uSizeVariation!.value = tuning.sizeVariation
    owned.uParticleGrowth!.value = tuning.particleGrowth
    owned.uParticleOpacity!.value = tuning.particleOpacity
    owned.uParticleSoftness!.value = tuning.particleSoftness
    owned.uLifetimeVariation!.value = tuning.lifetimeVariation
    owned.uSparkAmount!.value = tuning.sparkAmount
    owned.uTint!.value = tuning.tint
    owned.uWisps!.value = effects.wisps ? 1 : 0
    owned.uDraftOn!.value = effects.draft ? 1 : 0
    owned.uReduced!.value = reduced ? 1 : 0
    owned.uEmbers!.value = effects.embers && !reduced ? 1 : 0
    const smoke = owned.uSmoke!.value
    const ember = owned.uEmber!.value
    const paper = owned.uPaper!.value
    if (smoke instanceof THREE.Color) smoke.set(tuning.particleColor)
    if (ember instanceof THREE.Color) ember.set(tuning.sparkColor)
    if (paper instanceof THREE.Color) paper.set(tuning.backgroundColor)
    invalidate()
  }, [durationMs, effects, invalidate, reduced, texture, tuning, uniforms])

  useFrame((_, delta) => {
    const owned = material.current?.uniforms
    if (!owned) return
    owned.uTime!.value = performance.now() / 1000
    const wind = owned.uDraft!.value
    if (wind instanceof THREE.Vector2) wind.lerp(draft.current, 1 - Math.exp(-tuning.draftDamping * delta))
  })

  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={PLUME_VERT}
      fragmentShader={PLUME_FRAG}
      transparent
      premultipliedAlpha
      depthTest={false}
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

function sameIds(current: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  if (current.size !== next.size) return false
  for (const id of next) if (!current.has(id)) return false
  return true
}

function PlumeReleaseBridge({ capture, ids, onAnchors }: {
  capture: CaptureHandle
  ids: readonly string[]
  onAnchors: (anchors: Readonly<Record<string, SourceUvRect>>) => void
}) {
  const frames = useCaptureFrame(capture)
  const last = useRef('')
  useFrame(() => {
    const frame = frames.get()
    if (!frame || ids.some(id => !frame.anchors[id])) return
    const key = `${frame.sourceId}:${frame.generation}:${ids.join('|')}`
    if (last.current === key) return
    last.current = key
    const anchors: Record<string, SourceUvRect> = {}
    for (const id of ids) {
      const box = frame.anchors[id]
      anchors[id] = { cssWidth: box.width, cssHeight: box.height, uMin: box.x / frame.width, uMax: (box.x + box.width) / frame.width,
        vMin: 1 - (box.y + box.height) / frame.height, vMax: 1 - box.y / frame.height }
    }
    onAnchors(anchors)
  })
  return null
}

function PlumeParticles({ capture, box, ids, onAnchors, ...material }: Omit<PlumeMaterialProps, 'texture'> & {
  capture: CaptureHandle
  box: NonNullable<ReturnType<typeof useStageBox>>
  ids: readonly string[]
  onAnchors: (anchors: Readonly<Record<string, SourceUvRect>>) => void
}) {
  const frames = useCaptureFrame(capture)
  const frame = frames.get()
  if (!frame) return null
  return <mesh frustumCulled={false} position={[box.worldX, box.worldY, 0]} raycast={() => {}}>
    <primitive object={material.grid.geometry} attach="geometry" />
    <PlumeMaterial {...material} texture={frame.texture} />
    <PlumeReleaseBridge capture={capture} ids={ids} onAnchors={onAnchors} />
  </mesh>
}

export function PlumeApp() {
  const supported = useSurfaceSupport()
  const reduced = useReducedMotion()
  const inkCapture = useCaptureHandle()
  const sheet = useRef<HTMLDivElement>(null)
  const box = useStageBox(sheet)
  const draft = useRef(new THREE.Vector2())
  const [scrollTop, setScrollTop] = useState(0)
  const [effects, setEffects] = useState<PlumeEffects>(defaultPlumeEffects)
  const [tuning, setTuning] = useState<PlumeTuning>(plumeTuning)
  const [readyIds, setReadyIds] = useState<ReadonlySet<string>>(new Set())
  const readyIdsRef = useRef<ReadonlySet<string>>(new Set())
  const [paintedAnchors, setPaintedAnchors] = useState<Readonly<Record<string, SourceUvRect>> | null>(null)
  const [ledger, setLedger] = useState<TextLedger>(() => {
    const reconciled = reconcileUnits([], OPENING, plumeTuning.releaseUnit, performance.now(), plumeTuning.holdMs, 0)
    return { value: OPENING, units: reconciled.units, nextId: reconciled.nextId }
  })

  const durationMs = reduced ? tuning.reducedDurationMs : tuning.durationMs
  const now = useTimeline(ledger.units, durationMs)
  const phaseOf = useCallback(
    (unit: TimedUnit): UnitPhase => {
      const phase = unitPhase(unit, now, durationMs)
      // A delayed or failed capture keeps its DOM ink. Blank is never the
      // fallback for a visual enhancement.
      if (supported && phase !== 'held' && !readyIds.has(unit.id)) return 'held'
      return phase
    },
    [durationMs, now, readyIds, supported],
  )
  const animating = ledger.units.some((unit) => phaseOf(unit) === 'pluming')

  const grid = useMemo(
    () =>
      box
        ? buildPlumeGrid(box.width, box.height, tuning.pitch)
        : null,
    [box, tuning.pitch],
  )
  useEffect(() => () => grid?.geometry.dispose(), [grid])

  const unitIds = useMemo(() => ledger.units.map((unit) => unit.id), [ledger.units])
  const unitIdSignature = unitIds.join('\u0000')
  const releaseSignature = ledger.units
    .map((unit) => `${unit.id}:${unit.releaseAt.toFixed(2)}`)
    .join('\u0000')

  // An authored release time cannot predate the paint that supplies its
  // pixels. New anchors receive a full hold from their first usable painted
  // generation. This also makes a slow cold capture show the intact word,
  // not reveal a cloud whose clock already ended offscreen.
  useEffect(() => {
    if (!paintedAnchors) return
    const previous = readyIdsRef.current
    const next = new Set(
      ledger.units.filter((unit) => paintedAnchors[unit.id] !== undefined).map((unit) => unit.id),
    )
    const newlyReady = ledger.units.some(
      (unit) => next.has(unit.id) && !previous.has(unit.id),
    )
    readyIdsRef.current = next
    setReadyIds((current) => (sameIds(current, next) ? current : next))
    if (!newlyReady) return
    const releaseAt = performance.now() + tuning.holdMs
    setLedger((current) => ({
      ...current,
      units: current.units.map((unit) =>
        next.has(unit.id) && !previous.has(unit.id)
          ? { ...unit, releaseAt: Math.max(unit.releaseAt, releaseAt) }
          : unit,
      ),
    }))
  }, [paintedAnchors, unitIdSignature, ledger.units, tuning.holdMs])

  // Stamping lives in the page owner, not in the tunneled presenter. A
  // Restore changes no unit IDs and no anchor boxes, so an anchor effect in
  // that other reconciler has no reason to run. This primitive signature is
  // the release transaction: every new clock reaches the existing buffer.
  useEffect(() => {
    if (!grid || !paintedAnchors) return
    stampPlumeReleases(grid, ledger.units, paintedAnchors)
  }, [grid, ledger.units, paintedAnchors, releaseSignature])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const rect = sheet.current?.getBoundingClientRect()
      if (!rect) return
      const x = (event.clientX - (rect.left + rect.width / 2)) / Math.max(rect.width / 2, 1)
      const y = (rect.top + rect.height / 2 - event.clientY) / Math.max(rect.height / 2, 1)
      draft.current.set(Math.max(-1, Math.min(1, x)), Math.max(-0.45, Math.min(0.45, y)))
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  const changeText = useCallback((value: string) => {
    setLedger((current) => {
      const reconciled = reconcileUnits(
        current.units,
        value,
        tuning.releaseUnit,
        performance.now(),
        tuning.holdMs,
        current.nextId,
      )
      return { value, units: reconciled.units, nextId: reconciled.nextId }
    })
  }, [tuning.holdMs, tuning.releaseUnit])

  const restore = useCallback(() => {
    setLedger((current) => ({
      ...current,
      units: rearmUnits(current.units, performance.now(), tuning.holdMs),
    }))
  }, [tuning.holdMs])

  const clear = useCallback(() => {
    setLedger((current) => ({ ...current, value: '', units: [] }))
    setScrollTop(0)
  }, [])

  const toggle = useCallback((key: keyof PlumeEffects) => {
    setEffects((current) => ({ ...current, [key]: !current[key] }))
    if (!animating) restore()
  }, [animating, restore])

  const changeTuning = useCallback((next: PlumeTuning) => {
    const recapture = CAPTURE_TUNING_KEYS.some((key) => next[key] !== tuning[key])
    const replay = recapture || REPLAY_TUNING_KEYS.some((key) => next[key] !== tuning[key])
    setTuning(next)
    if (!replay && animating) return
    const editedAt = performance.now()
    setLedger((current) => {
      if (!recapture) return { ...current, units: rearmUnits(current.units, editedAt, next.holdMs) }
      const reconciled = reconcileUnits([], current.value, next.releaseUnit, editedAt, next.holdMs, current.nextId)
      return { ...current, units: reconciled.units, nextId: reconciled.nextId }
    })
  }, [animating, tuning])

  const reset = useCallback(() => {
    setEffects(defaultPlumeEffects)
    setTuning(plumeTuning)
    setLedger((current) => {
      const reconciled = reconcileUnits([], current.value, plumeTuning.releaseUnit,
        performance.now(), plumeTuning.holdMs, current.nextId)
      return { ...current, units: reconciled.units, nextId: reconciled.nextId }
    })
  }, [])

  const noteAnchors = useCallback((anchors: Readonly<Record<string, SourceUvRect>>) => {
    setPaintedAnchors((current) => (current === anchors ? current : anchors))
  }, [])

  // The parked capture lives outside this page's DOM ancestry. Carry the
  // same type values on every copy rather than relying on inherited styles.
  const typeStyle: PlumeStyle = {
    '--plume-font-family': FONT_FAMILIES[tuning.fontFamily],
    '--plume-type-scale': tuning.typeScale,
    '--plume-font-weight': tuning.fontWeight,
    '--plume-line-height': tuning.lineHeight,
    '--plume-letter-spacing': `${tuning.letterSpacing}em`,
    '--plume-ink': tuning.inkColor,
  }
  const pageStyle: PlumeStyle = {
    ...typeStyle,
    '--plume-text-width': `${tuning.textWidth}px`,
    '--plume-ghost-opacity': tuning.ghostOpacity,
    '--plume-ghost-blur': `${tuning.ghostBlur}px`,
    backgroundColor: tuning.backgroundColor,
  }
  const captureContent = (
    <PlumeCopy
      value={ledger.value}
      units={ledger.units}
      scrollTop={scrollTop}
      capture
      phaseOf={phaseOf}
      typeStyle={typeStyle}
    />
  )
  return (
    <main
      className="plume-page"
      style={pageStyle}
      data-degraded={!supported || undefined}
      data-reduced={reduced || undefined}
      data-afterglow={effects.afterglow || undefined}
    >
      <section className="plume-work" aria-label="evaporating writing surface">
        <div ref={sheet} className="plume-sheet">
          {/* The retained text sizes the centered field even after its ink
              fades. The final zero-width glyph preserves a trailing line. */}
          <div className="plume-measure plume-copy" style={typeStyle} aria-hidden="true">{ledger.value}{'\u200B'}</div>
          <PlumeCopy
            value={ledger.value}
            units={ledger.units}
            scrollTop={scrollTop}
            capture={false}
            phaseOf={phaseOf}
            typeStyle={typeStyle}
          />
          <textarea
            className="plume-input plume-copy"
            style={typeStyle}
            value={ledger.value}
            onChange={(event) => changeText(event.target.value)}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            aria-label="Write words that evaporate"
            aria-describedby="plume-note"
            maxLength={720}
            spellCheck
            autoCapitalize="sentences"
          />
        </div>
      </section>

      <PlumeTweaks effects={effects} onToggle={toggle} onRestore={restore} onClear={clear}
        tuning={tuning} onTuningChange={changeTuning} onReset={reset}
        supported={supported} reduced={reduced} animating={animating} />

      {supported && box && grid ? (
        <>
          <CaptureContent capture={inkCapture} size={[box.width, box.height]}
            resolution={Math.min(3.4, Math.max(2, 3600 / box.width))}>
            {captureContent}
          </CaptureContent>

          <SurfaceCanvas
            className="plume-canvas"
            frameloop="demand"
            style={{ position: 'fixed', inset: 0 }}
            gl={{ alpha: true, antialias: true }}
            camera={{ fov: FOV, position: [0, 0, 1000] }}
            onCreated={(state) => {
              state.gl.setClearAlpha(0)
              window.__r3f = state
            }}
          >
            <PlumeCamera />
            <PlumeFrames active={animating} />
            <PlumeParticles capture={inkCapture} box={box} grid={grid} ids={unitIds}
              onAnchors={noteAnchors} durationMs={durationMs} reduced={reduced}
              effects={effects} tuning={tuning} draft={draft} />
          </SurfaceCanvas>
        </>
      ) : null}

    </main>
  )
}
