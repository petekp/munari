// Cutaway prototype (`?scene=cutaway-prototype`) — a spec sheet of live HTML
// standing inside a camera, cutting the casing away as it scrolls.
//
// The law: the sheet's scroll position is the section plane's depth. Casing
// on the viewer's side of the sheet is removed and capped; the parts are not,
// so lens elements, the filter and the boards cross in front of the text,
// shade it, and show it through their glass. The lens throws the window
// opposite the camera onto the sheet, sharp only at the sensor's depth.
//
// Ownership: the page owns the scroll, the stations and the readout. The
// scene owns the camera framing and the sheet's pose. Both read one set of
// shader uniforms, written only from the scroll handler.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject, type WheelEvent } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
  useSurfaceNodes,
  useSurfaceRefresh,
  useCaptureSupport,
} from '@petepetrash/munari'
import { CaptureEngineStatus } from '../../components/CaptureEngineStatus'
import { cutDepthAt, projectOntoSheet, stationIndexAt, type CutStation } from './cutawayDepthLaw'
import {
  FILTER,
  LENS,
  PIXEL_PITCH,
  SENSOR_Z,
  SHEET,
  SHEET_FRONT_Z,
  SHEET_HEIGHT,
  SHEET_PX,
  SHEET_WIDTH,
} from './cutawayModel'
import { createCutawayUniforms, createSheetMaterial, type CutawayUniforms } from './cutawayNodes'
import { CutawayProduct } from './CutawayProduct'
import { CutawaySheet, SHEET_SECTIONS, formatDepth } from './CutawaySheet'
import './cutawayPrototype.css'

/** Pixels below the scroller's top edge where a heading counts as arrived. */
const READING_LINE = 6
const FILTER_BACK_Z = FILTER.z - FILTER.thickness / 2
const IR_CUT_TINT = new THREE.Color(0.74, 0.9, 1)
const VIEW = { yaw: -0.44, pitch: 0.17, target: new THREE.Vector3(10, -3, 4), fov: 24 } as const

function SheetMaterialSlot({ uniforms }: { readonly uniforms: CutawayUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createSheetMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function SheetPresenter({ uniforms, sheetZ }: { readonly uniforms: CutawayUniforms; readonly sheetZ: RefObject<number> }) {
  const pose = useRef<THREE.Group>(null)
  useFrame(() => {
    const group = pose.current
    if (group) group.position.z = sheetZ.current
  })
  return (
    <group ref={pose} position={[(SHEET.minX + SHEET.maxX) / 2, (SHEET.minY + SHEET.maxY) / 2, sheetZ.current]}>
      <Surface.Mesh
        placement="manual"
        pointerRoute="auto"
        scale={[SHEET_WIDTH, SHEET_HEIGHT, 1]}
        receiveShadow
        material={<SheetMaterialSlot uniforms={uniforms} />}
      />
    </group>
  )
}

/** Frames the camera body three-quarter from the front left, filling the stage. */
function CutawayFraming({ onInvalidate }: { readonly onInvalidate: RefObject<() => void> }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    onInvalidate.current = invalidate
  }, [invalidate, onInvalidate])
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    camera.fov = VIEW.fov
    camera.near = 20
    camera.far = 3000
    camera.aspect = size.width / Math.max(1, size.height)
    const halfV = Math.tan(THREE.MathUtils.degToRad(VIEW.fov / 2))
    const halfH = halfV * camera.aspect
    const distance = Math.max(76 / halfH, 57 / halfV)
    camera.position.set(
      VIEW.target.x + Math.sin(VIEW.yaw) * Math.cos(VIEW.pitch) * distance,
      VIEW.target.y + Math.sin(VIEW.pitch) * distance,
      VIEW.target.z + Math.cos(VIEW.yaw) * Math.cos(VIEW.pitch) * distance,
    )
    camera.lookAt(VIEW.target)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, size, invalidate])
  return null
}

/** The reflections the metal parts pick up: a city square, dimmed so the key light still models the body. */
const ENVIRONMENT_URL = '/hdri/potsdamer_platz_1k.hdr'
const ENVIRONMENT_INTENSITY = 0.45

/**
 * The environment map, baked once into a PMREM map before it is bound.
 * Binding the raw equirect texture instead let three build the PMREM map
 * lazily, and on about one snapDOM load in three a frame drew with a PMREM
 * texture already destroyed, which left the canvas empty.
 */
function StudioEnvironment() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    if (!(gl instanceof WebGPURenderer)) throw new Error('The cutaway environment needs the WebGPURenderer from SurfaceCanvas')
    let cancelled = false
    let baked: THREE.RenderTarget | null = null
    void new HDRLoader().loadAsync(ENVIRONMENT_URL).then((equirect) => {
      if (!cancelled) {
        equirect.mapping = THREE.EquirectangularReflectionMapping
        const generator = new PMREMGenerator(gl)
        baked = generator.fromEquirectangular(equirect)
        generator.dispose()
        scene.environment = baked.texture
        scene.environmentIntensity = ENVIRONMENT_INTENSITY
        invalidate()
      }
      equirect.dispose()
    })
    return () => {
      cancelled = true
      scene.environment = null
      baked?.dispose()
    }
  }, [gl, scene, invalidate])
  return null
}

function CutawayLights() {
  return (
    <>
      <hemisphereLight args={['#c9d2dc', '#2a2622', 0.5]} />
      <directionalLight
        position={[110, 170, 300]}
        intensity={2.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
        shadow-camera-near={100}
        shadow-camera-far={800}
        shadow-bias={-0.0004}
        shadow-radius={5}
        shadow-intensity={0.78}
        shadow-normalBias={0.25}
      />
      <directionalLight position={[-260, 80, 120]} intensity={0.55} color="#dfe8ff" />
    </>
  )
}

/** Refreshes the sheet when the section readout in its header changes. */
function SheetRefresh({ depthTenths }: { readonly depthTenths: number }) {
  const refresh = useSurfaceRefresh()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    refresh()
  }, [depthTenths, refresh])
  return null
}

export function CutawayPrototypeApp({ onReady }: { readonly onReady?: () => void }) {
  const supported = useCaptureSupport()
  const canvasId = useId()
  const sheet = useSurfaceHandle('cutaway-sheet')
  const uniforms = useMemo(createCutawayUniforms, [])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stations = useRef<CutStation[]>([{ scroll: 0, depth: SHEET_FRONT_Z }])
  const invalidate = useRef<() => void>(() => {})
  const sheetZ = useRef(SHEET_FRONT_Z)
  const [depthHundredths, setDepthHundredths] = useState(Math.round(SHEET_FRONT_Z * 100))

  useEffect(() => () => uniforms.blank.dispose(), [uniforms])

  const applyDepth = useCallback((depth: number) => {
    sheetZ.current = depth
    uniforms.sectionZ.value = depth
    const projection = projectOntoSheet(depth, LENS)
    uniforms.lensDistance.value = projection.distance
    uniforms.blurRadius.value = projection.blurRadius
    uniforms.irradiance.value = projection.irradiance
    const blocked = depth < SENSOR_Z
    if (blocked) uniforms.projectedTint.value.setRGB(0, 0, 0)
    else if (depth < FILTER_BACK_Z) uniforms.projectedTint.value.copy(IR_CUT_TINT)
    else uniforms.projectedTint.value.setRGB(1, 1, 1)
    setDepthHundredths(Math.round(depth * 100))
    invalidate.current()
  }, [uniforms])

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    applyDepth(cutDepthAt(scroller.scrollTop, stations.current))
  }, [applyDepth])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const measure = () => {
      const maxScroll = scroller.scrollHeight - scroller.clientHeight
      const sections = [...scroller.querySelectorAll<HTMLElement>('[data-depth]')]
      stations.current = sections.map((el, i) => ({
        scroll: i === 0 ? 0 : Math.min(maxScroll, el.offsetTop - READING_LINE),
        depth: Number(el.dataset.depth),
      }))
      onScroll()
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    void document.fonts?.ready.then(measure)
    return () => observer.disconnect()
  }, [onScroll])

  useEffect(() => {
    let alive = true
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (alive) requestAnimationFrame(() => onReady?.())
    })
    return () => {
      alive = false
    }
  }, [onReady])

  // A wheel anywhere on the stage reads the sheet, so the whole camera is the scroll control.
  const onStageWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current
    if (!scroller || !(event.target instanceof Node) || scroller.contains(event.target)) return
    scroller.scrollTop += event.deltaY
  }, [])

  const depth = depthHundredths / 100
  const station = SHEET_SECTIONS[stationIndexAt(depth, stations.current)] ?? SHEET_SECTIONS[0]
  const projection = projectOntoSheet(depth, LENS)
  const blurDiameter = projection.blurRadius * 2
  const blurPixels = Math.max(1, Math.round(blurDiameter / PIXEL_PITCH))
  const blurLabel = depth < SENSOR_Z
    ? 'blocked by sensor board'
    : `blur ⌀ ${blurDiameter.toFixed(2)} mm · ${blurPixels.toLocaleString('en-US')} px`

  return (
    <div className="cw-page">
      <header className="cw-frame cw-frame-top">
        <span>Cutaway · scroll the spec sheet</span>
        <CaptureEngineStatus />
      </header>
      <div className="cw-stage" onWheel={onStageWheel}>
        <div className="cw-sheet-slot">
          <Surface.Root surface={sheet} canvasId={canvasId} inScene={supported}>
            <Surface.HTML size={[SHEET_PX[0], SHEET_PX[1]]}>
              <CutawaySheet scrollerRef={scrollerRef} depth={depth} onScroll={onScroll} />
              <SheetRefresh depthTenths={Math.round(depth * 10)} />
            </Surface.HTML>
            <Surface.Scene>
              <SheetPresenter uniforms={uniforms} sheetZ={sheetZ} />
            </Surface.Scene>
          </Surface.Root>
        </div>
        {supported && (
          <SurfaceCanvas
            id={canvasId}
            className="cw-canvas"
            frameloop="demand"
            pointerMode="surfaces"
            shadows={{ enabled: true, type: THREE.PCFShadowMap }}
            gl={{ alpha: true }}
            onCreated={({ gl }) => gl.setClearAlpha(0)}
          >
            <CutawayFraming onInvalidate={invalidate} />
            <CutawayLights />
            <StudioEnvironment />
            <CutawayProduct uniforms={uniforms} sheet={sheet} />
          </SurfaceCanvas>
        )}
      </div>
      <footer className="cw-frame cw-readout" aria-live="polite">
        <p className="cw-statement">{station?.part}</p>
        <p className="cw-numbers">
          <span>section z {formatDepth(depth)} mm</span>
          <span>{blurLabel}</span>
          <span>f/2 · 26 mm</span>
        </p>
      </footer>
    </div>
  )
}
