// Variant A: Refractive polymer Cmd+K palette over a Swiss / Munari poster specimen.
//
// Bold color bands, coordinate rules, and display typography run directly behind
// the 30 px crystal bevel so Snell refraction and RGB dispersion read immediately,
// while the document underneath stays native selectable HTML at 0 fps idle.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { texture } from 'three/tsl'
import {
  Surface,
  SurfaceCanvas,
  useCaptureFrame,
  useElementCapture,
  useSurfaceNodes,
  useSurfacePaintedSize,
  useSurfaceStatus,
  useSurfaceSupport,
  type CaptureHandle,
  type ElementCapture,
} from '@petepetrash/munari'
import { Button, Tag } from '../../components/system'
import { FrontierCmdkPoster } from './FrontierCmdkPoster'
import {
  CMDK_SHADOW_PAD,
  createCmdkMaterial,
  createCmdkShadowMaterial,
  createCmdkUniforms,
  type CmdkUniforms,
} from './frontierCmdkNodes'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  createPaperPlaceholderTexture,
  retainActiveSurface,
  useReducedMotion,
} from './frontierStage'

const noRaycast = () => {}

interface CommandItem {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly shortcut: string
}

const COMMANDS: readonly CommandItem[] = [
  { id: 'prism-boost', label: 'Toggle flint-glass high dispersion', hint: '0.64 RGB wavelength split', shortcut: 'P' },
  { id: 'theme-poster', label: 'Switch poster to Munari color bands', hint: 'Coral, sky & ink bars', shortcut: '1' },
  { id: 'theme-grid', label: 'Switch poster to architectural grid', hint: 'Precision rule refraction', shortcut: '2' },
  { id: 'light-left', label: 'Move studio lamp to morning left', hint: 'Casts right caustic shadow', shortcut: 'L' },
  { id: 'light-right', label: 'Move studio lamp to evening right', hint: 'Casts left caustic shadow', shortcut: 'R' },
  { id: 'insert-note', label: 'Append live note to native HTML below', hint: 'Updates DOM underneath', shortcut: 'N' },
]

function CmdkOpticalSlot({
  bgCapture,
  uniforms,
}: {
  readonly bgCapture: CaptureHandle
  readonly uniforms: CmdkUniforms
}) {
  const surface = useSurfaceNodes()
  const bgFrames = useCaptureFrame(bgCapture)
  const [blank] = useState(createPaperPlaceholderTexture)
  const [bgMap] = useState(() => texture(blank))

  const material = useMemo(
    () => createCmdkMaterial(surface, bgMap, uniforms),
    [surface, bgMap, uniforms],
  )

  useEffect(
    () => () => {
      material.dispose()
      blank.dispose()
    },
    [material, blank],
  )

  useFrame(() => {
    const latest = bgFrames.get()
    if (latest) {
      bgMap.value = latest.texture
      uniforms.bgTexAspect.value = latest.height > 0 ? latest.width / latest.height : 1
    }
  })

  return <primitive object={material} attach="material" />
}

function CmdkShadowSkirt({
  uniforms,
  visible,
}: {
  readonly uniforms: CmdkUniforms
  readonly visible: boolean
}) {
  const painted = useSurfacePaintedSize()
  const meshRef = useRef<THREE.Mesh>(null)
  const material = useMemo(() => createCmdkShadowMaterial(uniforms), [uniforms])
  useEffect(() => () => material.dispose(), [uniforms, material])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const [pw, ph] = painted()
    const w = Math.max(pw || uniforms.panelSize.value.x, 1)
    const h = Math.max(ph || uniforms.panelSize.value.y, 1)
    mesh.scale.set((w + CMDK_SHADOW_PAD * 2) / w, (h + CMDK_SHADOW_PAD * 2) / h, 1)
  })

  return (
    <mesh
      ref={meshRef}
      position={[0, 0, -0.0008]}
      renderOrder={-1}
      raycast={noRaycast}
      visible={visible}
      material={material}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

function CmdkScenePresenter({
  bgCapture,
  slotElRef,
  lightPosRef,
  flintGlass,
  wakeRef,
}: {
  readonly bgCapture: ElementCapture
  readonly slotElRef: { readonly current: HTMLDivElement | null }
  readonly lightPosRef: { readonly current: { u: number; v: number } }
  readonly flintGlass: boolean
  readonly wakeRef: { current: (() => void) | null }
}) {
  const status = useSurfaceStatus()
  const invalidate = useThree((s) => s.invalidate)
  const uniforms = useMemo(createCmdkUniforms, [])

  useEffect(() => {
    wakeRef.current = () => invalidate()
    return () => {
      wakeRef.current = null
    }
  }, [invalidate, wakeRef])

  useEffect(() => {
    uniforms.refractStrength.value = flintGlass ? 0.175 : 0.115
    uniforms.dispersion.value = flintGlass ? 0.64 : 0.44
    uniforms.polymerOpacity.value = flintGlass ? 0.52 : 0.60
    invalidate()
  }, [flintGlass, uniforms, invalidate])

  useEffect(() => {
    if (status.presentation === 'scene') return retainActiveSurface()
    return undefined
  }, [status.presentation])

  useFrame(() => {
    const slot = slotElRef.current
    const bgBounds = bgCapture.getBounds()
    if (!slot || !bgBounds || bgBounds.width <= 0 || bgBounds.height <= 0) return
    const sr = slot.getBoundingClientRect()
    uniforms.panelSize.value.set(Math.max(sr.width, 1), Math.max(sr.height, 1))
    const offsetU = (sr.left - bgBounds.left) / bgBounds.width
    const offsetV = 1 - (sr.top + sr.height - bgBounds.top) / bgBounds.height
    const scaleU = sr.width / bgBounds.width
    const scaleV = sr.height / bgBounds.height
    uniforms.bgUvRect.value.set(offsetU, offsetV, scaleU, scaleV)

    const lx = bgBounds.left + lightPosRef.current.u * bgBounds.width
    const ly = bgBounds.top + lightPosRef.current.v * bgBounds.height
    const cx = sr.left + sr.width * 0.5
    const cy = sr.top + sr.height * 0.5
    uniforms.lightDeltaCss.value.set(lx - cx, ly - cy, 440)
  })

  return (
    <Surface.Mesh
      placement="match-dom"
      renderOrder={2}
      material={<CmdkOpticalSlot bgCapture={bgCapture} uniforms={uniforms} />}
    >
      <CmdkShadowSkirt uniforms={uniforms} visible={status.presentation === 'scene'} />
    </Surface.Mesh>
  )
}

export function FrontierCmdk() {
  const supported = useSurfaceSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const titleId = useId()
  const inputId = useId()
  const listboxId = useId()
  const articleCapture = useElementCapture()

  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [docTheme, setDocTheme] = useState<'poster' | 'grid'>('poster')
  const [flintGlass, setFlintGlass] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [lampUi, setLampUi] = useState({ u: 0.16, v: 0.08 })
  const [lastAction, setLastAction] = useState('Drag the top glass collar across the bold stripes')

  const stageRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const gripOverlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const lightPosRef = useRef({ u: 0.16, v: 0.08 })
  const wakeCanvasRef = useRef<(() => void) | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMANDS
    return COMMANDS.filter(
      (item) => item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q),
    )
  }, [query])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.show()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[activeIdx]
    if (item instanceof HTMLElement) item.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const refreshBg = useCallback(() => {
    requestAnimationFrame(() => {
      articleCapture.refresh()
      wakeCanvasRef.current?.()
    })
  }, [articleCapture])

  const setLampPosition = useCallback((u: number, v: number) => {
    lightPosRef.current = { u, v }
    setLampUi({ u, v })
    wakeCanvasRef.current?.()
  }, [])

  const executeCommand = useCallback(
    (cmd: CommandItem | undefined) => {
      if (!cmd) return
      if (cmd.id === 'theme-poster') {
        setDocTheme('poster')
        refreshBg()
      } else if (cmd.id === 'theme-grid') {
        setDocTheme('grid')
        refreshBg()
      } else if (cmd.id === 'light-left') {
        setLampPosition(0.14, 0.08)
      } else if (cmd.id === 'light-right') {
        setLampPosition(0.86, 0.08)
      } else if (cmd.id === 'prism-boost') {
        setFlintGlass((v) => !v)
      } else if (cmd.id === 'insert-note') {
        setNotes((prev) => [
          ...prev.slice(-2),
          `Live DOM update #${prev.length + 1}: Refracted in real time while prose stays selectable.`,
        ])
        refreshBg()
      }
      setLastAction(cmd.label)
    },
    [refreshBg, setLampPosition],
  )

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIdx((i) => (filtered.length > 0 ? (i + 1) % filtered.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIdx((i) => (filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      executeCommand(filtered[activeIdx] ?? filtered[0])
    }
  }

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    executeCommand(filtered[activeIdx] ?? filtered[0])
  }

  // Native viewport-space drag overlay positioned over the palette's top grip bar
  const onGripDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = {
      px: event.clientX,
      py: event.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    }
  }

  const onGripMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    const slot = slotRef.current
    const stage = stageRef.current
    const grip = gripOverlayRef.current
    if (!start || !slot || !stage || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const maxDx = Math.max(0, (stage.clientWidth - slot.offsetWidth) * 0.5 - 10)
    const minDy = -Math.max(0, slot.offsetTop - 12)
    const maxDy = Math.max(0, stage.clientHeight - slot.offsetTop - slot.offsetHeight - 12)
    const nx = Math.max(-maxDx, Math.min(maxDx, start.ox + (event.clientX - start.px)))
    const ny = Math.max(minDy, Math.min(maxDy, start.oy + (event.clientY - start.py)))
    offsetRef.current = { x: nx, y: ny }
    const tf = `translate3d(${nx}px, ${ny}px, 0)`
    slot.style.transform = tf
    if (grip) grip.style.transform = tf
    wakeCanvasRef.current?.()
  }

  const onGripUp = () => {
    dragStartRef.current = null
  }

  const onStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || dragStartRef.current) return
    const stage = stageRef.current
    if (!stage) return
    const r = stage.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    lightPosRef.current = {
      u: Math.max(0.05, Math.min(0.95, (event.clientX - r.left) / r.width)),
      v: Math.max(0.04, Math.min(0.45, (event.clientY - r.top) / r.height)),
    }
    wakeCanvasRef.current?.()
  }

  const activeItem = filtered[activeIdx]
  const activeOptionId = activeItem ? `${listboxId}-${activeItem.id}` : undefined

  return (
    <div className="frontier-bench">
      <div className="frontier-toolbar m-ui">
        <div className="frontier-controls-group">
          <Button compact variant={open ? 'solid' : 'outline'} onClick={() => setOpen((v) => !v)}>
            {open ? 'Palette open (⌘K)' : 'Open palette (⌘K)'}
          </Button>
          <Button compact variant={flintGlass ? 'solid' : 'outline'} onClick={() => setFlintGlass((v) => !v)}>
            {flintGlass ? 'Lens: Flint prism (0.64)' : 'Lens: Crown acrylic (0.44)'}
          </Button>
          <Button
            compact
            variant="outline"
            onClick={() => {
              setDocTheme((t) => (t === 'poster' ? 'grid' : 'poster'))
              refreshBg()
            }}
          >
            Ground: {docTheme === 'poster' ? 'Munari stripes' : 'Precision grid'}
          </Button>
        </div>
        <Tag>{lastAction}</Tag>
      </div>

      <div
        ref={stageRef}
        className="frontier-stage-wrap frontier-cmdk-stage"
        onPointerMove={onStagePointerMove}
      >
        <span
          className="frontier-lamp-pip"
          style={{ left: `${lampUi.u * 100}%`, top: `${lampUi.v * 100}%` }}
          aria-hidden="true"
        />

        <FrontierCmdkPoster
          articleRef={articleCapture.ref}
          docTheme={docTheme}
          notes={notes}
          onScroll={() => wakeCanvasRef.current?.()}
        />

        {open && (
          <div
            ref={gripOverlayRef}
            className="frontier-cmdk-grip-hit"
            title="Drag palette across stripes"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onLostPointerCapture={onGripUp}
          />
        )}

        <div
          ref={slotRef}
          className="frontier-cmdk-slot"
          style={{ display: open ? 'block' : 'none' }}
        >
          <Surface.Root canvasId={canvasId} inScene={supported && open}>
            <Surface.HTML>
              <div className={`frontier-cmdk-root${!supported ? ' frontier-cmdk-root--fallback' : ''}`}>
                <dialog ref={dialogRef} className="frontier-cmdk-dialog" aria-labelledby={titleId}>
                  <div className="frontier-cmdk-well">
                    <div className="frontier-cmdk-grip">
                      <span id={titleId} className="frontier-cmdk-title">
                        Drag glass rim across stripes
                      </span>
                      <button
                        type="button"
                        className="frontier-cmdk-close"
                        onClick={() => setOpen(false)}
                      >
                        Esc
                      </button>
                    </div>

                    <form className="frontier-cmdk-form" onSubmit={onFormSubmit}>
                      <label htmlFor={inputId} className="frontier-sr-only">
                        Filter commands
                      </label>
                      <input
                        id={inputId}
                        type="search"
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={listboxId}
                        aria-activedescendant={activeOptionId}
                        aria-autocomplete="list"
                        className="frontier-cmdk-input"
                        placeholder="Search optical or document commands…"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value)
                          setActiveIdx(0)
                        }}
                        onKeyDown={onInputKeyDown}
                      />
                      <button type="submit" className="frontier-cmdk-submit">
                        Run
                      </button>
                    </form>

                    <ul
                      ref={listRef}
                      id={listboxId}
                      className="frontier-cmdk-list"
                      role="listbox"
                      aria-label="Available commands"
                    >
                      {filtered.length === 0 ? (
                        <li role="option" aria-selected={false} aria-disabled="true" className="frontier-cmdk-empty">
                          No matching commands.
                        </li>
                      ) : (
                        filtered.map((item, idx) => {
                          const selected = idx === activeIdx
                          return (
                            <li
                              key={item.id}
                              id={`${listboxId}-${item.id}`}
                              role="option"
                              aria-selected={selected}
                              className="frontier-cmdk-option"
                              data-selected={selected || undefined}
                              onClick={() => {
                                setActiveIdx(idx)
                                executeCommand(item)
                              }}
                            >
                              <span>
                                <b>{item.label}</b>
                                <small>{item.hint}</small>
                              </span>
                              <kbd>{item.shortcut}</kbd>
                            </li>
                          )
                        })
                      )}
                    </ul>
                  </div>
                </dialog>
              </div>
            </Surface.HTML>
            <Surface.Scene>
              <CmdkScenePresenter
                bgCapture={articleCapture}
                slotElRef={slotRef}
                lightPosRef={lightPosRef}
                flintGlass={flintGlass}
                wakeRef={wakeCanvasRef}
              />
            </Surface.Scene>
          </Surface.Root>
        </div>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: false, depth: false }}
            onCreated={({ gl }) => gl.setClearAlpha(0)}
            className="frontier-overlay-canvas"
          >
            <FrontierPixelCamera />
            <FrontierCanvasTelemetry />
          </SurfaceCanvas>
        )}
      </div>
    </div>
  )
}
