// <Surface.WebGL> — one presentation of a source, as scene matter.
//
// The law: a warming presenter DRAWS, it does not hide. Several independent
// handoffs composite in one Canvas, so the old trick — hide the canvas
// until the incoming pixels are proven — takes every other Surface off
// screen with it. Instead this mesh draws with color, depth, and stencil
// writes disabled while its handoff is still warming: the texture and the
// shader program are warmed by a real draw, and invisible matter cannot
// punch a hole in the visible scene behind it. The first eligible
// COLOR-WRITING draw into the default framebuffer is the proof, taken in
// the post-draw callback, before the browser composites — which is what
// lets the DOM presentation be released in the same frame without ever
// showing a blank one.
//
// A write-free pass is deliberately NOT evidence. It draws nothing, so a
// receipt from one certifies an empty frame, and the page it releases goes
// dark. That distinction is the whole content of `passIsWarmUp` in the
// kernel, and it is why the two callbacks below are asymmetric: the before
// hook decides what the pass IS, the after hook decides what it PROVED.
//
// Ownership: this component owns the mesh, the default material, the
// raycast region, pointer relay, LOD demand, and presentation evidence. It
// owns no source and no protocol — the source belongs to the root, and the
// crossing belongs to the handle.

import {
  use,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeElements, type ThreeEvent } from '@react-three/fiber'
import {
  clearPointerState,
  deepestElementAt,
  forwardPointer,
  lastPointerPlace,
  nudgeSelect,
  passIsWarmUp,
  passNeedsHostTail,
  passPresentsDirectly,
  pointerSampleOf,
  rectIsMeasurable,
  resolveRadii,
  selectLodTier,
  silenceHoverMove,
  surfaceRadiusSd,
  trackDrag,
  trackFocusModality,
  trackPointerPlace,
  trackWheel,
  type ForwardPointerSample,
  type SurfacePartId,
  type SurfacePassEvidence,
} from '@munari/core'
import { SURFACE_RADIUS_GLSL } from '../../lib/surfaceRadiusGlsl'
import { FocusGroupContext } from '../focusContext'
import { SurfaceAnchorContext, useSurfaceAnchorScope } from './surfaceAnchorScope'
import { useLatest } from '../useLatest'
import {
  DEFAULT_PART,
  SurfaceMaterialContext,
  SurfacePartContext,
  SurfaceRootContext,
  SurfaceTunnelContext,
  type SurfaceMaterialValue,
  type SurfacePartValue,
} from './surfaceContext'
import { configureSurfaceMaterial } from './surfaceMaterials'
import {
  applyPassWrites,
  authoredWrites,
  restoreAuthoredWrites,
  type AuthoredWrites,
} from './surfaceWrites'
import { surfaceTierLadder, type SurfaceResolution } from './surfaceSourceRuntime'
import {
  MATCH_DOM_DISTANCE,
  createMatchDomResult,
  matchDomTransform,
  reportUnmatchableChain,
} from './matchDom'
import { surfaceStoreOf, type SurfaceHandle, type SurfaceStore } from './surfaceHandle'
import { useSurfaceHostContext } from './surfaceHostContext'

export type SurfaceRadius =
  | 'auto'
  | number
  | readonly [number, number, number, number]

export type SurfacePointerEvents = 'geometry' | 'content' | 'none'

/**
 * The pointer props are restated rather than inherited. R3F wraps its mesh
 * props in `Readonly<…>`, which on a function type yields an object with no
 * call signature — the handler arrives typed but cannot be invoked, and the
 * relay below has to call it after forwarding to the DOM.
 */
type SurfacePointerHandler = (event: ThreeEvent<PointerEvent>) => void

export interface SurfaceWebGLProps
  extends Omit<
    ThreeElements['mesh'],
    | 'children'
    | 'geometry'
    | 'material'
    | 'raycast'
    | 'ref'
    | 'onBeforeRender'
    | 'onAfterRender'
    | 'onPointerDown'
    | 'onPointerUp'
    | 'onPointerCancel'
    | 'onPointerMove'
    | 'onPointerOut'
  > {
  onPointerDown?: SurfacePointerHandler
  onPointerUp?: SurfacePointerHandler
  onPointerCancel?: SurfacePointerHandler
  onPointerMove?: SurfacePointerHandler
  onPointerOut?: SurfacePointerHandler
  /** Scene-specific geometry mapping before Munari applies its hit policy. */
  raycast?: THREE.Object3D['raycast']
  /** Separated wiring: the handle whose source this presents. */
  surface?: SurfaceHandle
  /** Which part of a multi-part Surface. Omitted for a single-source root. */
  part?: SurfacePartId
  placement?: 'match-dom' | 'manual'
  geometry?: React.ReactElement
  material?: React.ReactElement
  children?: React.ReactNode
  resolution?: SurfaceResolution
  radius?: SurfaceRadius
  /** `'opaque'` is a solid slab; `'source'` honors the capture's alpha. */
  alpha?: 'opaque' | 'source'
  pointerEvents?: SurfacePointerEvents
  ref?: React.Ref<THREE.Mesh>
}

// LOD evaluations run every Nth frame, phase-offset per presenter so a
// scene of many panels spreads the projection math and never re-rasters a
// cohort on the same frame.
const LOD_EVERY = 10
const LOD_AGREE = 2
let lodSeq = 0
let presenterSeq = 0

const _camPos = new THREE.Vector3()
const _surfPos = new THREE.Vector3()
const _surfScale = new THREE.Vector3()

/**
 * One presentation of a Surface.
 *
 * Declared in a scene tree it renders where it stands. Declared in a page
 * tree it renders NOTHING there and registers inward instead, because a
 * mesh cannot exist in the DOM reconciler — the host renders it inside the
 * Canvas, with the store and part passed as props rather than through a
 * context the two trees do not share.
 */
export function SurfaceWebGL({ surface, part, ...props }: SurfaceWebGLProps) {
  const root = use(SurfaceRootContext)
  const inheritedPart = use(SurfacePartContext)
  const tunneled = use(SurfaceTunnelContext)
  const store = surface ? surfaceStoreOf(surface) : (root?.store ?? null)
  if (!store) {
    throw new Error(
      'munari: <Surface.WebGL> found no Surface. Put it inside a <Surface>, or ' +
        'pass the handle it presents as `surface={…}` for separated wiring.',
    )
  }
  const partId = part ?? inheritedPart?.id ?? DEFAULT_PART
  const registerKey = useMemo(() => `webgl-${presenterSeq++}`, [])
  const host = root?.host ?? null

  // A page-declared presentation is registered, not rendered. The element
  // is rebuilt on every render so prop changes reach the scene, and the
  // registry keys it stably so the host reconciles rather than remounts —
  // a remount here would drop the presenter's readiness proof and hang the
  // handoff it was in the middle of.
  const inward = root !== null && root.wiring === 'page' && !tunneled
  const element = (
    <SurfaceTunnelContext value>
      <SurfacePresenter {...props} store={store} partId={partId} tunneled />
    </SurfaceTunnelContext>
  )
  useEffect(() => {
    if (!inward || !host) return
    return host.registerPresenter({ key: registerKey, element })
  })

  if (inward) return null
  return <SurfacePresenter {...props} store={store} partId={partId} tunneled={tunneled} />
}

interface PresenterProps extends Omit<SurfaceWebGLProps, 'surface' | 'part'> {
  store: SurfaceStore
  partId: SurfacePartId
  /** True when the host renders this on behalf of a page declaration. */
  tunneled: boolean
}

function SurfacePresenter({
  store,
  partId,
  tunneled,
  placement,
  geometry,
  material,
  children,
  resolution = 'auto',
  radius = 'auto',
  alpha = 'opaque',
  pointerEvents = 'geometry',
  ref,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerMove,
  onPointerOut,
  raycast: authoredRaycast,
  ...meshProps
}: PresenterProps) {
  const camera = useThree((s) => s.camera)
  const events = useThree((s) => s.events)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  // SAFETY: r3f's store types `controls` as a bare event target — whatever
  // the app set, if anything. Every control set this library suspends
  // carries `enabled`; the key stays optional so one that does not is
  // simply never disabled, not a crash.
  const controls = useThree((s) => s.controls as { enabled?: boolean } | null)

  const meshRef = useRef<THREE.Mesh>(null)
  // SAFETY: the handle is computed after the commit that assigns `ref` on
  // the mesh below, so the current value is the instance. A caller reading
  // it during its own render — before either commit — is the case the cast
  // covers over, and there is no earlier moment a mesh could exist.
  useImperativeHandle(ref, () => meshRef.current as THREE.Mesh, [])
  const materialRef = useRef<THREE.MeshBasicMaterial>(null)
  const pressedRef = useRef<ForwardPointerSample | null>(null)
  const presenterKey = useMemo(() => `presenter-${presenterSeq++}`, [])
  const lodPhase = useMemo(() => lodSeq++ % LOD_EVERY, [])
  const lodRef = useRef({ tier: 1, proposed: 1, agree: 0, frame: 0 })
  // What the pass in flight is doing, written by the before hook and read
  // once by the after hook. Not a boolean: the after hook has to tell a
  // direct presentation from a deferred one from a warm-up, and three hands
  // it no argument to tell them apart with.
  const passRef = useRef<SurfacePassEvidence | null>(null)
  // The material's own write flags as the caller left them, captured at the
  // top of each pass and put back at the bottom of it. Three's per-object
  // hooks are the only place a warm-up can be expressed, and they hand out
  // the SHARED material — so anything written here and not undone is
  // written for good, and for every other mesh using that material too.
  const authoredRef = useRef<AuthoredWrites>(authoredWrites())
  const matchRef = useRef(createMatchDomResult())

  // The part is read from the STORE, not a context. A presenter standing in
  // a scene tree with only a handle in hand has no ancestor that ever saw
  // the source — separated wiring is exactly the case where the two
  // declarations are in different trees.
  const part = useSyncExternalStore(
    useMemo(() => store.subscribeParts.bind(store), [store]),
    useMemo(() => () => store.part(partId), [store, partId]),
    useMemo(() => () => store.part(partId), [store, partId]),
  )
  const runtime = part?.runtime ?? null
  const texture = runtime?.texture() ?? null
  const reportError = useMemo(() => store.reportError.bind(store), [store])
  const [width, height] = part?.size ?? [1, 1]
  const presenterPart = useMemo<SurfacePartValue | null>(
    () =>
      part
        ? {
            ...part,
            setPageRoot: () => {},
            setMeasuredSize: () => {},
          }
        : null,
    [part],
  )
  // A tunneled presentation matches the page box it was declared beside;
  // one written inside a scene is placed by the scene. Where the
  // declaration was WRITTEN is the only thing that says which was meant.
  const effectivePlacement = placement ?? (tunneled ? 'match-dom' : 'manual')

  // Anchors are a transaction against the generation this presenter DRAWS,
  // so the scope lives here and not on the source: two presenters of the
  // same source can be showing different generations, and each one's
  // anchored matter belongs on the pixels under it.
  const anchors = useSurfaceAnchorScope(runtime, part?.captureRoot ?? null)

  const pointerEventsRef = useLatest(pointerEvents)
  const storeRef = useLatest(store)
  const partRef = useLatest(part)
  const mirrorU = runtime?.mirrorU() ?? false
  const mirrorURef = useLatest(mirrorU)
  const widthRef = useLatest(width)
  const heightRef = useLatest(height)
  const authoredRaycastRef = useLatest(authoredRaycast)
  const radiiRef = useRef<[number, number, number, number]>([0, 0, 0, 0])
  const radiusUniforms = useRef({
    uMunariRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
    uMunariSize: { value: new THREE.Vector2(width, height) },
  })

  // Presenter registration is the readiness ledger: the handoff cannot
  // release the page until every registered presenter has proven a
  // color-writing draw. Registering here rather than at first draw is what
  // makes a missing part BLOCK a handoff instead of silently shortening the
  // required set.
  useEffect(() => store.registerPresenter(presenterKey), [store, presenterKey])

  // The Canvas this presenter draws in — the pointer gate registers its
  // mesh here, and a deferred presentation waits on this host's frame tail.
  const presenterHost = useSurfaceHostContext()
  // The gate raycasts against exactly the registered meshes, so a full-page
  // Canvas stays clear everywhere no Surface stands. Deferred to an effect
  // because the mesh does not exist until after the commit.
  useEffect(() => {
    const mesh = meshRef.current
    if (!presenterHost || !mesh) return
    return presenterHost.registerObject(mesh)
  }, [presenterHost])

  // Document-level pointer machinery, reference-counted across every
  // Surface on the page — one set of listeners however many presenters.
  useEffect(() => trackFocusModality(), [])
  useEffect(() => trackWheel(), [])
  useEffect(() => trackDrag(), [])
  useEffect(() => trackPointerPlace(), [])

  // Scene removal is not presentation removal until the renderer draws the
  // scene without this mesh. A consumer that switches an active Canvas from
  // `always` to `demand` in the same commit would otherwise leave this
  // Surface's last pixels in the buffer, to be exposed later as a duplicate.
  useEffect(() => () => invalidate(), [invalidate])

  // Authored radii apply immediately; `'auto'` wears whatever the element's
  // own computed `border-radius` measured. The radius cannot come from
  // texture alpha: the authoring contract puts the app background on the
  // content root, so the region outside a rounded corner is opaquely
  // PAINTED — measured at 255,255,255,255 under a 14px-radius card.
  const chromeRadii = runtime?.chrome().radii
  useEffect(() => {
    radiusUniforms.current.uMunariSize.value.set(width, height)
    const corners = Array.isArray(radius) ? radius : [radius, radius, radius, radius]
    // SAFETY: four corners either way — the authored tuple, or one number
    // written to all four — so the map yields exactly four strings. `map`
    // is what cannot carry that length across.
    const lengths = corners.map((r) => `${r}px`) as [string, string, string, string]
    const next: [number, number, number, number] =
      radius === 'auto' ? (chromeRadii ?? [0, 0, 0, 0]) : resolveRadii(lengths, width, height)
    radiiRef.current = next
    radiusUniforms.current.uMunariRadii.value.set(next[0], next[1], next[2], next[3])
    const mat = materialRef.current
    if (mat) {
      // MSAA dithers the analytic edge smooth where plain discard would
      // alias it. Transparent surfaces get the same mask through ordinary
      // alpha blending instead.
      const wantA2C = !mat.transparent && next.some((r) => r > 0)
      if (mat.alphaToCoverage !== wantA2C) {
        mat.alphaToCoverage = wantA2C
        mat.needsUpdate = true
      }
    }
  }, [radius, width, height, chromeRadii])

  /**
   * The hit region.
   *
   * Declining HERE rather than inside the handlers is the whole point: an
   * intersection r3f never sees is one it never counts as a hover, so the
   * Surface behind keeps the pointer instead of being told it lost it. That
   * is what makes a floating layer possible — its slab is full panel size
   * and stands in front of the panel it belongs to, so with `'geometry'`
   * the moment a popover opened the layer caught every ray, the panel
   * behind went dead, and — hearing `pointerOut` — dismissed the very thing
   * that had just opened.
   *
   * Installed unconditionally and branching on a ref, never swapped for
   * `undefined`: r3f assigns props onto the instance, and handing back
   * undefined leaves the last function attached rather than restoring the
   * class default — the mesh would stay permanently un-hittable.
   */
  const raycast = useMemo<THREE.Object3D['raycast']>(
    () =>
      function (this: THREE.Mesh, raycaster, intersects) {
        // Input follows the eye (crossingPointer, decisions.md #33). While
        // the canvas is not the presented side this mesh is not pointer
        // matter: the gate never goes solid, so a lifting-phase click
        // reaches the page copy the viewer is actually looking at instead
        // of relaying to the parked one.
        if (!storeRef.current.canvasHearsPointer()) return
        const cast = authoredRaycastRef.current ?? THREE.Mesh.prototype.raycast
        const mode = pointerEventsRef.current
        if (mode === 'none') return
        if (mode === 'geometry') {
          const radii = radiiRef.current
          if (radii.some((r) => r > 0)) {
            // A rounded surface's corners are not surface. The same SDF as
            // the material mask, on the RAW uv, so a ray and a fragment
            // agree about where the corner ends.
            const hits: THREE.Intersection[] = []
            cast.call(this, raycaster, hits)
            for (const hit of hits) {
              if (
                !hit.uv ||
                surfaceRadiusSd(hit.uv.x, hit.uv.y, widthRef.current, heightRef.current, radii) <= 0
              ) {
                intersects.push(hit)
              }
            }
            return
          }
          cast.call(this, raycaster, intersects)
          return
        }
        const el = elementRef.current
        if (!el) return
        const hits: THREE.Intersection[] = []
        cast.call(this, raycaster, hits)
        const rect = el.getBoundingClientRect()
        for (const hit of hits) {
          if (!hit.uv) continue
          const u = mirrorURef.current ? 1 - hit.uv.x : hit.uv.x
          const x = rect.left + u * rect.width
          const y = rect.top + (1 - hit.uv.y) * rect.height
          if (deepestElementAt(el, x, y)) intersects.push(hit)
        }
      },
    // Stable ref identities — this memo never actually re-runs.
    [storeRef, pointerEventsRef, mirrorURef, widthRef, heightRef, authoredRaycastRef],
  )

  const elementRef = useRef<HTMLElement | null>(null)
  elementRef.current = runtime?.element ?? null

  // `'content'` also makes the source's own root transparent: a bare
  // full-size container is scaffolding, not a thing to touch. What is
  // inside declares its own, in CSS, exactly as it would on a 2D page.
  useEffect(() => {
    const el = runtime?.element
    if (!el || pointerEvents !== 'content') return
    const previous = el.style.pointerEvents
    el.style.pointerEvents = 'none'
    return () => {
      el.style.pointerEvents = previous
    }
  }, [runtime, pointerEvents])

  // Inside a FocusGroup this presenter is a composite focus member: the
  // source root becomes the group's unit element and its interior is
  // browser-traversed DOM (docs/focus.md). Outside one, nothing changes.
  const focusGroup = use(FocusGroupContext)
  const sourceEl = runtime?.element ?? null
  const label = store.name
  useEffect(() => {
    if (!focusGroup || !sourceEl) return
    return focusGroup.registerComposite({
      root: sourceEl,
      object: meshRef.current,
      label,
    })
  }, [focusGroup, sourceEl, label])

  // The presenter's own name in the source's tier ledger. Every presenter
  // of one source proposes independently and the source takes the maximum,
  // so a distant panel cannot downgrade the raster a near one needs.
  const lodKey = useMemo(() => lodSeq++, [])

  /** Position-attribute version as of the last frame; null until seen once. */
  const rerouteRef = useRef<number | null>(null)

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return

    if (effectivePlacement === 'match-dom') {
      const pageRoot = part?.pageRoot
      const rect = pageRoot?.getBoundingClientRect()
      if (pageRoot) reportUnmatchableChain(pageRoot, reportError)
      if (rect && rectIsMeasurable(rect)) {
        const match = matchDomTransform(
          camera,
          rect,
          { width: size.width, height: size.height },
          MATCH_DOM_DISTANCE,
          matchRef.current,
        )
        mesh.position.copy(match.position)
        mesh.quaternion.copy(match.quaternion)
        mesh.scale.copy(match.scale)
        mesh.updateMatrixWorld()
      }
    }

    // The pointer is retold after the world moves. Events raycast the
    // geometry as it stood when they arrived, so under a per-frame
    // deformation every relay is one frame stale — and when the hand then
    // stops, the LAST event's routing is never corrected while the geometry
    // settles on. Measured (2026-08-20, instruments/fisheye-pointer): at
    // 40px event spacing over 22px rows the relayed hover landed more than
    // one row off and stayed there. A position-attribute version bump is
    // the deformation's own receipt (deformSurfaceGeometry sets it), and
    // r3f's `events.update` re-raycasts the pointer's last position against
    // the current pose — hover twins and coordinates catch up within a
    // frame, whether the hand moved or only the matter did.
    const position = mesh.geometry?.getAttribute('position')
    // An interleaved position carries its version on the shared buffer, and
    // no Surface geometry interleaves — the plain-attribute case is the law
    // deformSurfaceGeometry already enforces.
    if (position instanceof THREE.BufferAttribute) {
      if (
        rerouteRef.current !== null &&
        rerouteRef.current !== position.version &&
        store.canvasHearsPointer()
      ) {
        events.update?.()
      }
      rerouteRef.current = position.version
    }

    // Dynamic LOD: compare projected screen density — device px per CSS px
    // — against the current tier every LOD_EVERY-th frame. `proposeTier`
    // re-rasterizes through the normal onpaint path, so the source's upload
    // picks it up like any other content change.
    if (!runtime) return
    if (resolution !== 'auto' && !Array.isArray(resolution)) return
    const lod = lodRef.current
    if (lod.frame++ % LOD_EVERY !== lodPhase) return
    // SAFETY: three's own brand, tested before any perspective-only field
    // is read; r3f types the store's camera as the base class.
    const cam = camera as THREE.PerspectiveCamera
    const geom = mesh.geometry
    if (!cam.isPerspectiveCamera || !geom) return
    if (!geom.boundingSphere) geom.computeBoundingSphere()
    const sphere = geom.boundingSphere
    if (!sphere) return
    mesh.getWorldPosition(_surfPos)
    mesh.getWorldScale(_surfScale)
    cam.getWorldPosition(_camPos)
    const dist = Math.max(_camPos.distanceTo(_surfPos), 1e-3)
    const worldDiag = 2 * sphere.radius * Math.max(_surfScale.x, _surfScale.y, _surfScale.z)
    const pxPerWorld = gl.domElement.height / (2 * dist * Math.tan((cam.fov * Math.PI) / 360))
    const density = (pxPerWorld * worldDiag) / Math.hypot(width, height)
    const ladder = surfaceTierLadder(resolution, width, height)
    const proposal = selectLodTier(density, lod.tier, ladder)
    if (proposal === lod.tier) {
      lod.agree = 0
    } else if (proposal === lod.proposed) {
      if (++lod.agree >= LOD_AGREE) {
        lod.tier = proposal
        lod.agree = 0
        runtime.proposeTier(lodKey, proposal)
      }
    } else {
      lod.proposed = proposal
      lod.agree = 1
    }
  })

  useEffect(() => {
    if (!runtime) return
    return () => runtime.proposeTier(lodKey, null)
  }, [runtime, lodKey])

  // Whether this presenter's pixels may be SEEN this frame. A resident
  // Surface always presents — there is no page holding anything back. An
  // exclusive one presents only once the page has let go, and draws
  // write-free until then.
  const handleBeforeRender = useCallback<THREE.Object3D['onBeforeRender']>(
    (renderer, _scene, _cam, _geometry, renderedMaterial) => {
      const defaultFramebuffer = renderer.getRenderTarget() === null
      // Read live from the store, never from a render-time value. The
      // crossing gives the canvas presentation authority at the top of this
      // frame and the page lets go in the post-draw callback below, so the
      // two happen inside one draw — and a value captured at render would
      // be one commit stale exactly where the protocol is decided.
      const writing = store.canvasPresents()
      // The write-free warm-up. Color, depth, and stencil are all disabled
      // together: color alone still lets invisible matter write depth, and
      // a depth-writing invisible quad punches a hole through every visible
      // object behind it — which reads as a rectangular window into the
      // clear color, in the exact shape of a Surface nobody can see. The
      // authored values are borrowed, not overwritten — the post-draw
      // callback below puts them back.
      applyPassWrites(authoredRef.current, renderedMaterial, writing)
      passRef.current = {
        defaultFramebuffer,
        colorWrite: renderedMaterial.colorWrite,
        depthWrite: renderedMaterial.depthWrite,
        stencilWrite: renderedMaterial.stencilWrite,
      }
    },
    [store],
  )

  // What a completed pass PROVED, in the two stages decisions.md #25 splits
  // apart. A direct color-writing pass closes stage two here, in the
  // post-draw callback and before the browser composites, which is what
  // lets the page be released in the same frame the pixels land. A pass
  // that wrote color into a target has not reached the screen and defers to
  // the host's tail.
  const handleAfterRender = useCallback<THREE.Object3D['onAfterRender']>(() => {
    // Restored FIRST, before any of the early returns below. The draw is
    // over the moment this runs, and every path out of here — no receipt,
    // nothing uploaded, a warm-up — must leave the material exactly as the
    // caller authored it.
    restoreAuthoredWrites(authoredRef.current)
    const pass = passRef.current
    passRef.current = null
    if (!pass) return
    if (!runtime?.uploaded()) return
    // The generation on the geometry, which is the one an anchor set has to
    // describe. Read after the draw because that is when it is true.
    if (!passIsWarmUp(pass)) {
      anchors.noteDrawn(runtime.source.sourceId, runtime.uploadedGeneration())
    }
    const lifetime = store.readinessLifetime()
    const epoch = store.epoch()
    // Stage one. A warm-up counts: it compiled the program and sampled the
    // texture, which is the whole question the lift gate asks. Making stage
    // one wait for color instead is a deadlock, because color is exactly
    // what the lift gate is deciding whether to allow.
    store.prove(presenterKey, lifetime, epoch)
    if (passIsWarmUp(pass)) return
    // Stage two, and only stage two releases the page.
    if (passPresentsDirectly(pass)) {
      store.present(presenterKey, epoch)
      return
    }
    if (!passNeedsHostTail(pass)) return
    presenterHost?.deferPresentation(() => store.present(presenterKey, epoch))
  }, [runtime, store, presenterKey, presenterHost, anchors])

  // The mask, injected into the default material. Always injected and
  // uniform-driven: radii of zero make it a no-op, so there is one program
  // family and a radius change is a value write, never a recompile.
  // Identical source text across instances on purpose — three keys its
  // program cache on this function's toString, so every Surface shares one
  // compiled program despite each wiring its own uniform objects.
  const onBeforeCompile = useMemo(
    () => (shader: { uniforms: Record<string, { value: unknown }>; fragmentShader: string }) => {
      shader.uniforms.uMunariRadii = radiusUniforms.current.uMunariRadii
      shader.uniforms.uMunariSize = radiusUniforms.current.uMunariSize
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <clipping_planes_pars_fragment>',
          '#include <clipping_planes_pars_fragment>\n' + SURFACE_RADIUS_GLSL,
        )
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n' +
            '  diffuseColor.a *= munariRadiusMask(vUv);\n' +
            '  if (diffuseColor.a < 0.004) discard;\n',
        )
    },
    [],
  )

  const uvOf = (e: ThreeEvent<PointerEvent>) => {
    if (!e.uv) return null
    return { u: mirrorU ? 1 - e.uv.x : e.uv.x, v: e.uv.y }
  }

  // Munari's relay runs FIRST, then the caller's handler. The relay is what
  // makes the event mean anything at the DOM — a caller handler that ran
  // first would see a press the source has not yet heard about.
  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    const active = pressedRef.current
    if (active && active.pointerId !== e.nativeEvent.pointerId) return
    e.stopPropagation()
    // Every pointer that reaches a texture arrives as a native event whose
    // target is the <canvas> — outside every portaled layer in the
    // document. Libraries that detect outside-interaction that way (Radix's
    // DismissableLayer, and every menu built on it) therefore dismiss on
    // ANY click into a Surface, including clicks on their own content.
    // Suppressing the canvas event is not a workaround: the canvas is how
    // the pointer travelled, not what it hit. Only pointerdown — silencing
    // document-level move and up would strand a drag that began on empty
    // space and ended over a panel.
    e.nativeEvent.stopPropagation()
    const uv = uvOf(e)
    const el = runtime?.element
    if (uv && el) {
      // A plain copy, not the event: this record outlives the dispatch and
      // gets spread into a cancel later, and a retained PointerEvent spreads
      // to nothing — the cancel would carry pointerId: undefined and be
      // refused by the relay's cancel guard, leaving the press open forever.
      pressedRef.current = pointerSampleOf(e.nativeEvent)
      if (controls) controls.enabled = false
      forwardPointer(el, uv.u, uv.v, 'down', e.nativeEvent)
    }
    onPointerDown?.(e)
  }

  const handleUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const active = pressedRef.current
    if (active && active.pointerId === e.nativeEvent.pointerId) {
      const uv = uvOf(e)
      const el = runtime?.element
      if (controls) controls.enabled = true
      pressedRef.current = null
      if (uv && el) {
        const hit = forwardPointer(el, uv.u, uv.v, 'up', e.nativeEvent)
        if (hit?.target instanceof HTMLSelectElement) nudgeSelect(hit.target)
      }
    }
    onPointerUp?.(e)
  }

  const handleCancel = (e: ThreeEvent<PointerEvent>) => {
    const active = pressedRef.current
    if (active && active.pointerId === e.nativeEvent.pointerId) {
      e.stopPropagation()
      const uv = uvOf(e) ?? { u: 0, v: 0 }
      const el = runtime?.element
      pressedRef.current = null
      if (controls) controls.enabled = true
      if (el) forwardPointer(el, uv.u, uv.v, 'cancel', e.nativeEvent)
    }
    onPointerCancel?.(e)
  }

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    // Topmost Surface under the pointer owns it (DOM semantics). Also keeps
    // bubbled child-layer events — which carry the CHILD's UV — from being
    // misread as coordinates on this surface.
    e.stopPropagation()
    const uv = uvOf(e)
    const el = runtime?.element
    if (uv && el) {
      forwardPointer(el, uv.u, uv.v, 'move', e.nativeEvent)
      // The forwarded move is this pointer's true story; the native one —
      // target CANVAS, screen coordinates — must not also reach
      // document-level coordinate reasoners. Hover only: drag moves keep
      // bubbling for OrbitControls.
      silenceHoverMove(e.nativeEvent)
    }
    onPointerMove?.(e)
  }

  const handleOut = (e: ThreeEvent<PointerEvent>) => {
    const el = runtime?.element
    if (el) clearPointerState(el)
    onPointerOut?.(e)
  }

  // A release can occur after the ray leaves the Surface. R3F then has no
  // intersected mesh to notify, so close the matching relay in the next
  // task if the mesh handler did not already do it.
  useEffect(() => {
    let pendingEnd = 0
    const cancelActive = (sample?: ForwardPointerSample) => {
      const active = pressedRef.current
      if (!active) return
      const el = elementRef.current
      if (el) {
        forwardPointer(el, 0, 0, 'cancel', {
          ...(sample ?? active),
          button: 0,
          buttons: 0,
          pressure: 0,
        })
      }
      pressedRef.current = null
      if (controls) controls.enabled = true
    }
    const onEnd = (e: PointerEvent) => {
      const active = pressedRef.current
      if (!active || active.pointerId !== e.pointerId) return
      // Chrome runs a microtask checkpoint after document capture and
      // before R3F handles the same event on its connected div
      // (2026-08-16). A microtask therefore cancelled the press before the
      // mesh saw pointerup, so a button rendered on a Surface received down
      // but never click. A timer crosses the event-dispatch boundary.
      if (pendingEnd) window.clearTimeout(pendingEnd)
      pendingEnd = window.setTimeout(() => {
        pendingEnd = 0
        if (pressedRef.current?.pointerId === e.pointerId) cancelActive(pointerSampleOf(e))
      }, 0)
    }
    const onBlur = () => cancelActive()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancelActive()
    }
    document.addEventListener('pointerup', onEnd, true)
    document.addEventListener('pointercancel', onEnd, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('pointerup', onEnd, true)
      document.removeEventListener('pointercancel', onEnd, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      if (pendingEnd) window.clearTimeout(pendingEnd)
      cancelActive()
    }
  }, [controls])

  // The edge bursts (decisions.md #33). crossingPointer routes the NEXT
  // event; it says nothing about state either side holds ACROSS the flip,
  // and the relay only speaks on pointer MOTION — so a pointer that sits
  // still through a flip leaves the loser wearing stale state and the
  // gainer blind to a pointer already over it. Losing, the canvas closes
  // its story out: the active relayed press is cancelled and the stamped
  // twins cleared. Gaining, it re-arms: one forwarded move at the
  // pointer's last trusted position, so the hover the page copy was
  // showing continues on the texture instead of popping off at the swap.
  // The hold flip is the signal because it fires synchronously from the
  // frame that moved it — a React commit would arrive a frame after the
  // state it is correcting.
  useEffect(
    () =>
      store.subscribeHold(() => {
        // One microtask later: the losing flip fires from tick() and the
        // gaining flip from inside a presenter's post-draw callback, and a
        // burst dispatched there would run consumer DOM handlers in the
        // middle of the frame. The branch is re-read at run time, so two
        // flips inside one frame act once each on whatever is then true.
        queueMicrotask(() => {
          const el = elementRef.current
          if (!store.canvasHearsPointer()) {
            const active = pressedRef.current
            pressedRef.current = null
            if (controls) controls.enabled = true
            if (!el) return
            if (active) {
              forwardPointer(el, 0, 0, 'cancel', {
                ...active,
                button: 0,
                buttons: 0,
                pressure: 0,
              })
            }
            clearPointerState(el)
            return
          }
          if (!el) return
          // Re-arm only where the arrival position is knowable: a manual
          // mesh is wherever the scene put it, so mapping through the page
          // box would stamp hover on content the pointer is not over.
          if (effectivePlacement !== 'match-dom') return
          if (pointerEventsRef.current === 'none') return
          const place = lastPointerPlace()
          if (!place) return
          // A held button means some pointer's press story is still open —
          // possibly another surface's live relayed drag, which one
          // buttonless document-bubbling move would break mid-gesture. The
          // pointer's first real motion re-arms hover instead.
          if (place.sample.buttons !== 0) return
          const rect = partRef.current?.pageRoot?.getBoundingClientRect()
          if (!rect || !rectIsMeasurable(rect)) return
          if (
            place.x < rect.left ||
            place.x > rect.right ||
            place.y < rect.top ||
            place.y > rect.bottom
          )
            return
          // Hover only: a press held across the flip died at the edge
          // (its side of the story), so the arrival move carries no buttons.
          forwardPointer(
            el,
            (place.x - rect.left) / rect.width,
            1 - (place.y - rect.top) / rect.height,
            'move',
            { ...place.sample, button: 0, buttons: 0, pressure: 0 },
          )
        })
      }),
    [store, controls, partRef, effectivePlacement, pointerEventsRef],
  )

  // A presenter mounted after the scene's first frame compiles its material
  // BEFORE the texture exists; three will not recompile the program when
  // `.map` is later assigned, because program choice is keyed on
  // material.version. Without this bump the surface stays blank forever.
  useEffect(() => {
    if (texture && materialRef.current) materialRef.current.needsUpdate = true
  }, [texture])

  const transparent = alpha === 'source'

  // The caller's material is handed the presenter's own uniform objects, so
  // a radius change reaches a spliced mask as a value write rather than as a
  // recompile — and so a custom material cannot silently wire a private copy
  // that compiles once and then never moves.
  const materialSlot = useMemo<SurfaceMaterialValue>(
    () => ({
      radii: radiusUniforms.current.uMunariRadii,
      size: radiusUniforms.current.uMunariSize,
      transparent,
    }),
    [transparent],
  )

  // A caller's material is held to the library's alpha convention after
  // every commit, not once at mount: the object in the slot is replaced by
  // an ordinary re-render, and one that reaches the renderer with straight
  // blending has already drawn the dark fringe (see surfaceMaterials.tsx).
  const custom = material !== undefined
  useEffect(() => {
    const mesh = meshRef.current
    if (!custom || !mesh?.material) return
    configureSurfaceMaterial(mesh.material)
  })

  // Without the capability there is no capture and no texture, so the mesh
  // would draw a bare slate rectangle in front of a page that is still
  // perfectly visible. Drawing nothing is the honest answer: a Twin degrades
  // to its DOM presentation, and an exclusive Surface never leaves `dom`
  // because no presenter can prove a thing.
  if (!store.getState().supported || !texture) return null

  return (
    <SurfacePartContext value={presenterPart}>
      <SurfaceAnchorContext value={anchors}>
      <mesh
        ref={meshRef}
        raycast={raycast}
        {...meshProps}
        onPointerDown={handleDown}
        onPointerUp={handleUp}
        onPointerCancel={handleCancel}
        onPointerMove={handleMove}
        onPointerOut={handleOut}
        onBeforeRender={handleBeforeRender}
        onAfterRender={handleAfterRender}
      >
        {geometry ?? <planeGeometry args={[1, 1]} />}
        {/* A custom material mounts only once a configured texture exists, so
            `useSurfaceTexture()` in it never sees null and never has to
            re-bind on a later render a memoized material may not take. */}
        {material ? (
          <SurfaceMaterialContext value={materialSlot}>{material}</SurfaceMaterialContext>
        ) : (
          <meshBasicMaterial
            ref={materialRef}
            map={texture}
            color="#ffffff"
            transparent={transparent}
            premultipliedAlpha
            toneMapped={false}
            defines={{ USE_UV: '' }}
            onBeforeCompile={onBeforeCompile}
          />
        )}
        {children}
      </mesh>
      </SurfaceAnchorContext>
    </SurfacePartContext>
  )
}
