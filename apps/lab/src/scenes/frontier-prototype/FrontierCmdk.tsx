// Variant 01 (`FrontierCmdk`): Optical Liquid-Crystal Command Bar.
//
// Pairs a translucent, borderless command palette `<Surface>` with Munari's
// physical rounded-rect SDF meniscus refraction, 5-tap spectral dispersion,
// and 16-tap hardware trilinear mipmap frost over a live selectable HTML folio —
// idling at `0 fps` when stationary.

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
  useSurfaceRefresh,
  useSurfaceStatus,
  useCaptureSupport,
  type CaptureHandle,
  type ElementCapture,
} from '@petepetrash/munari'
import { Button } from '../../components/system'
import {
  CMDK_COMMANDS,
  FrontierCmdkDialog,
  type CommandItem,
} from './FrontierCmdkDialog'
import { FrontierCmdkPoster } from './FrontierCmdkPoster'
import {
  CMDK_LENSES,
  CMDK_SHADOW_PAD,
  applyCmdkLens,
  createCmdkMaterial,
  createCmdkShadowMaterial,
  createCmdkUniforms,
  type CmdkLensId,
  type CmdkUniforms,
} from './frontierCmdkNodes'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  useReducedMotion,
} from './frontierStage'
import './frontierCmdk.css'

const noRaycast = () => {}

function createMipmapPlaceholder(): THREE.DataTexture {
  const data = new Uint8Array([246, 244, 238, 255])
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  return tex
}

function useSlotSize(
  ref: { readonly current: HTMLElement | null },
  fallbackW: number,
  fallbackH: number,
  active: boolean,
): readonly [number, number] {
  const [size, setSize] = useState<readonly [number, number]>([fallbackW, fallbackH])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const nw = Math.max(1, Math.round(r.width))
      const nh = Math.max(1, Math.round(r.height))
      setSize((prev) => (prev[0] === nw && prev[1] === nh ? prev : [nw, nh]))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active, ref])

  return size
}

function CmdkOpticalSlot({
  bgCapture,
  uniforms,
}: {
  readonly bgCapture: CaptureHandle
  readonly uniforms: CmdkUniforms
}) {
  const surface = useSurfaceNodes()
  const bgFrames = useCaptureFrame(bgCapture)
  const [blank] = useState(createMipmapPlaceholder)
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
      uniforms.bgReady.value = 1
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
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const [pw, ph] = painted()
    const w = Math.max(pw || uniforms.panelRectCss.value.z, 1)
    const h = Math.max(ph || uniforms.panelRectCss.value.w, 1)
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
  lens,
  syncKey,
  wakeRef,
}: {
  readonly bgCapture: ElementCapture
  readonly slotElRef: { readonly current: HTMLDivElement | null }
  readonly lightPosRef: { readonly current: { u: number; v: number } }
  readonly lens: CmdkLensId
  readonly syncKey: string
  readonly wakeRef: { current: (() => void) | null }
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const invalidate = useThree((s) => s.invalidate)
  const uniforms = useMemo(createCmdkUniforms, [])
  const prevSyncRef = useRef(syncKey)

  useEffect(() => {
    wakeRef.current = () => invalidate()
    return () => {
      wakeRef.current = null
    }
  }, [invalidate, wakeRef])

  useLayoutEffect(() => {
    applyCmdkLens(uniforms, lens)
    invalidate()
  }, [lens, uniforms, invalidate])

  useEffect(() => {
    if (prevSyncRef.current !== syncKey) {
      prevSyncRef.current = syncKey
      refreshSurface()
    }
  }, [refreshSurface, syncKey])

  useEffect(() => {
    if (status.presentation === 'scene') return retainActiveSurface()
    return undefined
  }, [status.presentation])

  useFrame(() => {
    const slot = slotElRef.current
    const bgBounds = bgCapture.getBounds()
    if (!slot || !bgBounds || bgBounds.width <= 0 || bgBounds.height <= 0) return
    const sr = slot.getBoundingClientRect()
    uniforms.bgSizeCss.value.set(bgBounds.width, bgBounds.height)
    uniforms.panelRectCss.value.set(
      sr.left - bgBounds.left,
      sr.top - bgBounds.top,
      Math.max(sr.width, 1),
      Math.max(sr.height, 1),
    )

    const lx = bgBounds.left + lightPosRef.current.u * bgBounds.width
    const ly = bgBounds.top + lightPosRef.current.v * bgBounds.height
    const cx = sr.left + sr.width * 0.5
    const cy = sr.top + sr.height * 0.5
    uniforms.lightDeltaCss.value.set(lx - cx, ly - cy, 440)
  })

  return (
    <Surface.Mesh
      placement="match-dom"
      pointerRoute="auto"
      renderOrder={2}
      material={<CmdkOpticalSlot bgCapture={bgCapture} uniforms={uniforms} />}
    >
      <CmdkShadowSkirt uniforms={uniforms} visible={status.presentation === 'scene'} />
    </Surface.Mesh>
  )
}

export function FrontierCmdk() {
  const supported = useCaptureSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const inputId = useId()
  const listboxId = useId()
  // Pinned 1.5x resolution ensures Munari builds a full hardware trilinear mipmap chain
  // (`surfaceSourceRuntime.ts` `applyFilterPolicy`): mip 0 stays crisp for the crystal bezel
  // while mip 4.35 delivers silky, ghost-free frosted diffusion in the interior well.
  const articleCapture = useElementCapture({ resolution: 1.5 })

  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [lens, setLens] = useState<CmdkLensId>('crown')
  const [docTheme, setDocTheme] = useState<'folio' | 'studio'>('folio')
  const [notes, setNotes] = useState<string[]>([])
  const [lampSide, setLampSide] = useState<'left' | 'right'>('left')
  const [dragHover, setDragHover] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const gripOverlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const lightPosRef = useRef({ u: 0.16, v: 0.08 })
  const wakeCanvasRef = useRef<(() => void) | null>(null)

  const [slotW, slotH] = useSlotSize(slotRef, 548, 344, open)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return CMDK_COMMANDS
    return CMDK_COMMANDS.filter(
      (item) => item.label.toLowerCase().includes(q) || item.meta.toLowerCase().includes(q),
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
    if (item instanceof HTMLElement && list.scrollHeight > list.clientHeight) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIdx])

  const refreshBg = useCallback(() => {
    requestAnimationFrame(() => {
      articleCapture.refresh()
      wakeCanvasRef.current?.()
    })
  }, [articleCapture])

  const toggleLampSweep = useCallback(() => {
    const next = lampSide === 'left' ? 'right' : 'left'
    setLampSide(next)
    const targetU = next === 'left' ? 0.14 : 0.86
    if (reducedMotion) {
      lightPosRef.current = { u: targetU, v: 0.08 }
      wakeCanvasRef.current?.()
      return
    }
    const startU = lightPosRef.current.u
    const t0 = performance.now()
    const dur = 360
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur)
      const ease = 1 - Math.pow(1 - t, 3)
      lightPosRef.current = { u: startU + (targetU - startU) * ease, v: 0.08 }
      wakeCanvasRef.current?.()
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [lampSide, reducedMotion])

  const executeCommand = useCallback(
    (cmd: CommandItem | undefined) => {
      if (!cmd) return
      if (cmd.id === 'lens-flint') {
        setLens((cur) => (cur === 'flint' ? 'crown' : 'flint'))
      } else if (cmd.id === 'lens-smoked') {
        setLens((cur) => (cur === 'smoked' ? 'crown' : 'smoked'))
      } else if (cmd.id === 'toggle-ground') {
        setDocTheme((t) => (t === 'folio' ? 'studio' : 'folio'))
        refreshBg()
      } else if (cmd.id === 'sweep-lamp') {
        toggleLampSweep()
      } else if (cmd.id === 'insert-note') {
        setNotes((prev) => [
          ...prev.slice(-2),
          `Note #${prev.length + 1} appended to native DOM — refracted live at 0 fps idle.`,
        ])
        refreshBg()
      }
    },
    [refreshBg, toggleLampSweep],
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

  const onGripDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.nativeEvent.isTrusted) return
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
    if (!event.nativeEvent.isTrusted || reducedMotion || dragStartRef.current) return
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

  const syncKey = `${lens}:${query}:${activeIdx}:${docTheme}:${dragHover ? 1 : 0}`

  return (
    <div className="frontier-bench">
      <div className="frontier-toolbar m-ui">
        <div className="frontier-controls-group">
          <Button compact variant={open ? 'solid' : 'outline'} onClick={() => setOpen((v) => !v)}>
            {open ? 'Palette open (⌘K)' : 'Open palette (⌘K)'}
          </Button>
          {(['crown', 'flint', 'smoked'] as const).map((id) => (
            <Button
              key={id}
              compact
              variant={lens === id ? 'solid' : 'outline'}
              onClick={() => setLens(id)}
            >
              {CMDK_LENSES[id].label}
            </Button>
          ))}
          <Button
            compact
            variant={docTheme === 'studio' ? 'solid' : 'outline'}
            onClick={() => {
              setDocTheme((t) => (t === 'folio' ? 'studio' : 'folio'))
              refreshBg()
            }}
          >
            {docTheme === 'folio' ? 'Ground: Editorial folio' : 'Ground: Dark studio'}
          </Button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="frontier-stage-wrap frontier-cmdk-stage"
        onPointerMove={onStagePointerMove}
      >
        <FrontierCmdkPoster
          articleRef={articleCapture.ref}
          docTheme={docTheme}
          notes={notes}
          onScroll={() => wakeCanvasRef.current?.()}
        />

        {open && (
          <div
            ref={gripOverlayRef}
            className="cmdk-grip-hit"
            title="Drag command bar across color blocks"
            onPointerEnter={() => setDragHover(true)}
            onPointerLeave={() => setDragHover(false)}
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onLostPointerCapture={onGripUp}
          />
        )}

        <div
          ref={slotRef}
          className="cmdk-slot"
          style={{ display: open ? 'block' : 'none' }}
        >
          <Surface.Root canvasId={canvasId} inScene={supported && open}>
            <Surface.HTML size={[slotW, slotH]}>
              <FrontierCmdkDialog
                dialogRef={dialogRef}
                listRef={listRef}
                inputId={inputId}
                listboxId={listboxId}
                open={open}
                supported={supported}
                lens={lens}
                docTheme={docTheme}
                dragHover={dragHover}
                query={query}
                activeIdx={activeIdx}
                filtered={filtered}
                onChangeQuery={(next) => {
                  setQuery(next)
                  setActiveIdx(0)
                }}
                onInputKeyDown={onInputKeyDown}
                onFormSubmit={onFormSubmit}
                onClose={() => setOpen(false)}
                onHoverIdx={setActiveIdx}
                onExecuteIdx={(idx, item) => {
                  setActiveIdx(idx)
                  executeCommand(item)
                }}
              />
            </Surface.HTML>
            <Surface.Scene>
              <CmdkScenePresenter
                bgCapture={articleCapture}
                slotElRef={slotRef}
                lightPosRef={lightPosRef}
                lens={lens}
                syncKey={syncKey}
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
            gl={{ alpha: true, antialias: true, depth: false }}
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
