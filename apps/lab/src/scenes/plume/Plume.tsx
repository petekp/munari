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
// React wiring and DOM. plumeLaw owns word time, plumeCloud owns grains, and
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
  Surface,
  SurfaceCanvas,
  useSurface,
  useSurfaceAnchorRects,
  useSurfaceTexture,
  useSupportsDOMSurfaces,
  type SourceUvRect,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { textureSlot } from '../../lib/uniforms'
import { buildPlumeGrid, stampPlumeReleases, type PlumeGrid } from './plumeCloud'
import {
  nextTimelineBoundary,
  rearmWords,
  reconcileWords,
  wordPhase,
  type TimedWord,
  type WordPhase,
} from './plumeLaw'
import { PLUME_FRAG, PLUME_VERT } from './plumeShaders'
import {
  defaultPlumeEffects,
  plumeTuning,
  type PlumeEffects,
} from './plumeTuning'
import './plume.css'

const FOV = 42
const OPENING = 'Some thoughts only need enough time to become weather.'

interface TextLedger {
  readonly value: string
  readonly words: readonly TimedWord[]
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
  readonly words: readonly TimedWord[]
  readonly scrollTop: number
  readonly capture: boolean
  readonly phaseOf: (word: TimedWord) => WordPhase
}

function PlumeCopy({ value, words, scrollTop, capture, phaseOf }: PlumeCopyProps) {
  const pieces: React.ReactNode[] = []
  let cursor = 0
  for (const word of words) {
    if (word.start > cursor) {
      pieces.push(
        <Fragment key={`space-${cursor}`}>
          {value.slice(cursor, word.start)}
        </Fragment>,
      )
    }
    pieces.push(
      <span
        key={word.id}
        className="plume-word"
        data-munari-anchor={capture ? word.id : undefined}
        data-phase={capture ? undefined : phaseOf(word)}
      >
        {word.text}
      </span>,
    )
    cursor = word.end
  }
  if (cursor < value.length) {
    pieces.push(<Fragment key={`space-${cursor}`}>{value.slice(cursor)}</Fragment>)
  }

  return (
    <div className={capture ? 'plume-capture plume-copy' : 'plume-mirror plume-copy'} aria-hidden>
      <div className="plume-copy__flow" style={{ transform: `translateY(${-scrollTop}px)` }}>
        {pieces.length > 0 ? (
          pieces
        ) : capture ? null : (
          <span className="plume-prompt">Write something you can let go of.</span>
        )}
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

function useTimeline(words: readonly TimedWord[], durationMs: number): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const boundary = nextTimelineBoundary(words, now, durationMs)
    if (boundary === null) return
    const wait = Math.max(0, boundary - performance.now() + 8)
    const timer = window.setTimeout(() => setNow(performance.now()), wait)
    return () => window.clearTimeout(timer)
  }, [words, now, durationMs])
  return now
}

function useStageBox(ref: React.RefObject<HTMLElement | null>): StageBox | null {
  const [box, setBox] = useState<StageBox | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      setBox({
        width: rect.width,
        height: rect.height,
        worldX: rect.left + rect.width / 2 - window.innerWidth / 2,
        worldY: window.innerHeight / 2 - (rect.top + rect.height / 2),
      })
    }
    measure()
    void document.fonts.ready.then(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
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
  readonly grid: PlumeGrid
  readonly durationMs: number
  readonly reduced: boolean
  readonly effects: PlumeEffects
  readonly draft: React.RefObject<THREE.Vector2>
}

function PlumeMaterial({ grid, durationMs, reduced, effects, draft }: PlumeMaterialProps) {
  const texture = useSurfaceTexture()
  const material = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uTime: { value: 0 },
      uDuration: { value: durationMs / 1000 },
      uStagger: { value: plumeTuning.staggerMs / 1000 },
      uRise: { value: plumeTuning.rise },
      uCurl: { value: plumeTuning.curl },
      uDepth: { value: plumeTuning.depth },
      uWisps: { value: 1 },
      uDraftOn: { value: 1 },
      uReduced: { value: 0 },
      uDraft: { value: new THREE.Vector2() },
      uGrain: { value: new THREE.Vector2(grid.cellWidth, grid.cellHeight) },
      uPitchUv: { value: new THREE.Vector2(1 / grid.cols, 1 / grid.rows) },
      uSmoke: { value: new THREE.Color('#53677d') },
      uEmber: { value: new THREE.Color('#ef694b') },
      uEmbers: { value: 1 },
    }),
    [durationMs, grid.cellHeight, grid.cellWidth, grid.cols, grid.rows],
  )
  uniforms.tMap.value = texture

  useFrame(() => {
    const owned = material.current?.uniforms
    if (!owned) return
    owned.uTime!.value = performance.now() / 1000
    owned.uDuration!.value = durationMs / 1000
    owned.uWisps!.value = effects.wisps ? 1 : 0
    owned.uDraftOn!.value = effects.draft ? 1 : 0
    owned.uReduced!.value = reduced ? 1 : 0
    owned.uEmbers!.value = effects.embers && !reduced ? 1 : 0
    const wind = owned.uDraft!.value
    if (wind instanceof THREE.Vector2) wind.lerp(draft.current, 0.08)
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

function PlumeReleaseBridge({
  ids,
  onAnchors,
}: {
  readonly ids: readonly string[]
  readonly onAnchors: (anchors: Readonly<Record<string, SourceUvRect>>) => void
}) {
  const anchors = useSurfaceAnchorRects(ids)
  useEffect(() => {
    if (!anchors) return
    onAnchors(anchors)
  }, [anchors, onAnchors])
  return null
}

const EFFECTS: readonly {
  readonly key: keyof PlumeEffects
  readonly label: string
  readonly detail: string
}[] = [
  { key: 'wisps', label: 'Curl', detail: 'lift ink into long threads' },
  { key: 'afterglow', label: 'Ghost ink', detail: 'leave a faint impression' },
  { key: 'embers', label: 'Warm fibres', detail: 'catch a few lit edges' },
  { key: 'draft', label: 'Draft', detail: 'let the pointer bend the air' },
]

function EffectControls({
  effects,
  onToggle,
}: {
  readonly effects: PlumeEffects
  readonly onToggle: (key: keyof PlumeEffects) => void
}) {
  return (
    <fieldset className="plume-effects">
      <legend>What the ink carries</legend>
      {EFFECTS.map((effect) => (
        <label key={effect.key} className="plume-effect">
          <input
            type="checkbox"
            checked={effects[effect.key]}
            onChange={() => onToggle(effect.key)}
          />
          <span className="plume-effect__mark" aria-hidden />
          <span>
            <strong>{effect.label}</strong>
            <small>{effect.detail}</small>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

export function PlumeApp({ chips }: { chips?: React.ReactNode }) {
  const supported = useSupportsDOMSurfaces()
  const reduced = useReducedMotion()
  const surface = useSurface('plume-ink')
  const sheet = useRef<HTMLDivElement>(null)
  const box = useStageBox(sheet)
  const draft = useRef(new THREE.Vector2())
  const [scrollTop, setScrollTop] = useState(0)
  const [effects, setEffects] = useState<PlumeEffects>(defaultPlumeEffects)
  const [readyIds, setReadyIds] = useState<ReadonlySet<string>>(new Set())
  const readyIdsRef = useRef<ReadonlySet<string>>(new Set())
  const [paintedAnchors, setPaintedAnchors] = useState<Readonly<Record<string, SourceUvRect>> | null>(null)
  const [ledger, setLedger] = useState<TextLedger>(() => {
    const reconciled = reconcileWords([], OPENING, performance.now(), plumeTuning.holdMs, 0)
    return { value: OPENING, words: reconciled.words, nextId: reconciled.nextId }
  })

  const durationMs = reduced ? plumeTuning.reducedDurationMs : plumeTuning.durationMs
  const now = useTimeline(ledger.words, durationMs)
  const phaseOf = useCallback(
    (word: TimedWord): WordPhase => {
      const phase = wordPhase(word, now, durationMs)
      // A delayed or failed capture keeps its DOM ink. Blank is never the
      // fallback for a visual enhancement.
      if (supported && phase !== 'held' && !readyIds.has(word.id)) return 'held'
      return phase
    },
    [durationMs, now, readyIds, supported],
  )
  const animating = ledger.words.some((word) => phaseOf(word) === 'pluming')

  const grid = useMemo(
    () =>
      box
        ? buildPlumeGrid(box.width, box.height, plumeTuning.pitch)
        : null,
    [box],
  )
  useEffect(() => () => grid?.geometry.dispose(), [grid])

  const wordIds = useMemo(() => ledger.words.map((word) => word.id), [ledger.words])
  const wordIdSignature = wordIds.join('\u0000')
  const releaseSignature = ledger.words
    .map((word) => `${word.id}:${word.releaseAt.toFixed(2)}`)
    .join('\u0000')

  // An authored release time cannot predate the paint that supplies its
  // pixels. New anchors receive a full hold from their first usable painted
  // generation. This also makes a slow cold capture show the intact word,
  // not reveal a cloud whose clock already ended offscreen.
  useEffect(() => {
    if (!paintedAnchors) return
    const previous = readyIdsRef.current
    const next = new Set(
      ledger.words.filter((word) => paintedAnchors[word.id] !== undefined).map((word) => word.id),
    )
    const newlyReady = ledger.words.some(
      (word) => next.has(word.id) && !previous.has(word.id),
    )
    readyIdsRef.current = next
    setReadyIds((current) => (sameIds(current, next) ? current : next))
    if (!newlyReady) return
    const releaseAt = performance.now() + plumeTuning.holdMs
    setLedger((current) => ({
      ...current,
      words: current.words.map((word) =>
        next.has(word.id) && !previous.has(word.id)
          ? { ...word, releaseAt: Math.max(word.releaseAt, releaseAt) }
          : word,
      ),
    }))
  }, [paintedAnchors, wordIdSignature, ledger.words])

  // Stamping lives in the page owner, not in the tunneled presenter. A
  // Restore changes no word IDs and no anchor boxes, so an anchor effect in
  // that other reconciler has no reason to run. This primitive signature is
  // the release transaction: every new clock reaches the existing buffer.
  useEffect(() => {
    if (!grid || !paintedAnchors) return
    stampPlumeReleases(grid, ledger.words, paintedAnchors)
  }, [grid, ledger.words, paintedAnchors, releaseSignature])

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
      const reconciled = reconcileWords(
        current.words,
        value,
        performance.now(),
        plumeTuning.holdMs,
        current.nextId,
      )
      return { value, words: reconciled.words, nextId: reconciled.nextId }
    })
  }, [])

  const restore = useCallback(() => {
    setLedger((current) => ({
      ...current,
      words: rearmWords(current.words, performance.now(), plumeTuning.holdMs),
    }))
  }, [])

  const clear = useCallback(() => {
    setLedger((current) => ({ ...current, value: '', words: [] }))
    setScrollTop(0)
  }, [])

  const toggle = useCallback((key: keyof PlumeEffects) => {
    setEffects((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const noteAnchors = useCallback((anchors: Readonly<Record<string, SourceUvRect>>) => {
    setPaintedAnchors((current) => (current === anchors ? current : anchors))
  }, [])

  const capture = (
    <PlumeCopy
      value={ledger.value}
      words={ledger.words}
      scrollTop={scrollTop}
      capture
      phaseOf={phaseOf}
    />
  )
  const held = ledger.words.filter((word) => phaseOf(word) === 'held').length

  return (
    <main
      className="plume-page"
      data-degraded={!supported || undefined}
      data-reduced={reduced || undefined}
      data-afterglow={effects.afterglow || undefined}
    >
      <header className="plume-intro">
        <span className="plume-kicker">live carbon study</span>
        <h1>Plume</h1>
        <p>Words hold for one breath, then leave the page.</p>
      </header>

      <section className="plume-work" aria-label="evaporating writing surface">
        <div ref={sheet} className="plume-sheet">
          <div className="plume-rule" aria-hidden />
          <PlumeCopy
            value={ledger.value}
            words={ledger.words}
            scrollTop={scrollTop}
            capture={false}
            phaseOf={phaseOf}
          />
          <textarea
            className="plume-input plume-copy"
            value={ledger.value}
            onChange={(event) => changeText(event.target.value)}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            aria-label="Write words that evaporate"
            aria-describedby="plume-note"
            maxLength={720}
            spellCheck
            autoCapitalize="sentences"
          />
          <div className="plume-sheet__meta" aria-hidden>
            <span>{String(ledger.words.length).padStart(2, '0')} set</span>
            <span>{String(held).padStart(2, '0')} held</span>
          </div>
        </div>

        <div className="plume-actions">
          <p id="plume-note">
            The words remain in the native textarea. <kbd>⌘A</kbd> can still find what the page no
            longer shows.
          </p>
          <div>
            <button type="button" onClick={restore}>Restore text</button>
            <button type="button" onClick={clear}>Clear</button>
          </div>
        </div>
      </section>

      <EffectControls effects={effects} onToggle={toggle} />

      <p className="plume-status" role="status">
        {!supported
          ? 'HTML-in-canvas is unavailable · using the quiet DOM dissolve'
          : reduced
            ? 'Reduced motion · ink dissolves in place'
            : animating
              ? 'Ink is in the air'
              : 'Waiting for the next word'}
      </p>

      {supported && box && grid ? (
        <>
          <Surface
            surface={surface}
            size={[box.width, box.height]}
            resolution={Math.min(3.4, Math.max(2, 3600 / box.width))}
            source={capture}
          >
            <Surface.WebGL
              placement="manual"
              alpha="source"
              pointerEvents="none"
              frustumCulled={false}
              position={[box.worldX, box.worldY, 0]}
              geometry={<primitive object={grid.geometry} attach="geometry" />}
              material={
                <PlumeMaterial
                  grid={grid}
                  durationMs={durationMs}
                  reduced={reduced}
                  effects={effects}
                  draft={draft}
                />
              }
            >
              <PlumeReleaseBridge
                key={wordIdSignature}
                ids={wordIds}
                onAnchors={noteAnchors}
              />
            </Surface.WebGL>
          </Surface>

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
          </SurfaceCanvas>
        </>
      ) : null}

      {chips}
    </main>
  )
}
