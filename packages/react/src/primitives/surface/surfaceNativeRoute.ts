// The route controller — one presenter's half of the pointer-route law
// (decisions.md #39): read the conditions off three's own matrices, apply the
// kernel's verdict to the DOM rig, and run the handoff in the order the law
// states.
//
// The law: the binding OBSERVES, the kernel DECIDES. Nothing here chooses a
// route; it collects `PointerRouteConditions` and hands them to `routeFor`.
// The one judgement that is genuinely the binding's is planarity, because
// only the binding can see the geometry: a `matrix3d` is a planar homography,
// and this library will only claim planarity for a plane it built, nobody
// deformed, and no scene raycast reshapes.
//
// The fault: a claim of planarity that is wrong does not fail loudly. The
// content still draws from the texture, so the panel looks right; only the
// hit region has moved, and it has moved to wherever a flat quad would have
// been. That is why the check is "did we make this geometry and has anyone
// touched it" rather than a tolerance on the vertices — a bent Surface that
// is bent by less than the tolerance is still a Surface whose pointer lands
// in the wrong row, and the measured cost of that failure is already on
// record (2026-08-20, instruments/fisheye-pointer: relayed hover landed more
// than one row off at 40px event spacing over 22px rows).
//
// Ownership: this module owns the per-presenter route state and the pose
// inputs. `@munari/core` owns the verdict, the arithmetic, and the rig. The
// presenter owns the relay's own story, which arrives here as callbacks
// because only the presenter knows what press is open.

import * as THREE from 'three'
import {
  createNativePointerRig,
  createSurfacePose,
  nativeRideStyle,
  pointerRouteHandoff,
  poseOnScreen,
  routeFor,
  surfacePose,
  zIndexAbove,
  type NativePointerRig,
  type PointerRoute,
  type PointerRouteHandoff,
  type PointerRouteRequest,
  type SurfacePose,
} from '@munari/core'
import { DEFORMED_MARKER } from './surfaceDeform'
import { sceneMeshCovers } from './surfaceOcclusion'
import { hostSpace, inHostSpace } from './surfaceHostSpace'
import { claimSourcePointer, releaseSourcePointer, registerSourcePointerPresenter, sourceHasOnePointerPose } from './surfacePointerOwnership'

/** Everything one frame's verdict is read from. */
export interface SurfaceRouteStep {
  readonly mesh: THREE.Mesh
  readonly camera: THREE.Camera
  readonly renderMatrix?: THREE.Matrix4
  /** The renderer canvas — the viewport the projection lands in. */
  readonly glCanvas: HTMLCanvasElement
  /** The node the engine parks the content in, null before the runtime exists. */
  readonly host: HTMLElement | null
  /** The drawn root inside it. */
  readonly root: HTMLElement | null
  readonly request: PointerRouteRequest
  readonly capable: boolean
  readonly hearing: boolean
  readonly contentWidth: number
  readonly contentHeight: number
  /** True when the scene supplied its own geometry. */
  readonly authoredGeometry: boolean
  /** True when the scene supplied its own raycast. */
  readonly authoredRaycast: boolean
  readonly pointerEvents: 'geometry' | 'content' | 'none'
  /** The pointer's last trusted place in viewport coordinates, null before any. */
  readonly pointer: { readonly x: number; readonly y: number; readonly buttons: number } | null
}

/**
 * The handoff duties only the relay can perform, in the law's order. The
 * controller calls these; it never inspects them.
 */
export interface SurfaceRouteRelayDuties {
  readonly closeRelay: () => void
  readonly rearmRelay: () => void
  readonly bridgePage: () => void
}

export interface SurfaceRouteController {
  /** Decide and apply this frame's route. Returns the handoff, moved or not. */
  step: (input: SurfaceRouteStep, duties: SurfaceRouteRelayDuties) => PointerRouteHandoff
  registerSource: (host: HTMLElement) => () => void
  route: () => PointerRoute
  /** True while the parked host is lifted over the renderer canvas. */
  riding: () => boolean
  /** Bring everything down, for teardown. Consults no law. */
  release: () => void
}

interface SurfacePlaneRecord {
  readonly position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  readonly positionVersion: number
  readonly uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  readonly uvVersion: number
  readonly index: THREE.BufferAttribute | null
  readonly indexVersion: number | undefined
  readonly start: number
  readonly count: number
}
const planes = new WeakMap<THREE.BufferGeometry, SurfacePlaneRecord>()

const POINTER_TYPES = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel'] as const
function positionVersion(position: SurfacePlaneRecord['position']): number {
  return 'version' in position ? position.version : position.data.version
}
export function registerSurfacePlane(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  if (position && uv) planes.set(geometry, {
    position, positionVersion: positionVersion(position),
    uv, uvVersion: positionVersion(uv),
    index: geometry.index, indexVersion: geometry.index?.version,
    start: geometry.drawRange.start, count: geometry.drawRange.count,
  })
}

/**
 * Is the presented shape one this library can vouch is the flat quad the
 * pose describes?
 *
 * `DEFORMED_MARKER` is `deformSurfaceGeometry`'s own receipt, stamped on the
 * geometry instance — so it survives a presenter swap and catches a scene
 * that deforms the default plane through a mesh ref (Slider does). An
 * authored geometry is one this library cannot vouch for however flat it
 * happens to be, and an authored raycast is a scene's own hit policy, which
 * the browser cannot be told to honor. Every answer is conservative: the
 * cost of a wrong "no" is the relay, which already works.
 */
export function presentsUnitPlane(
  mesh: THREE.Mesh,
  authoredGeometry: boolean,
  authoredRaycast: boolean,
): boolean {
  if (authoredGeometry || authoredRaycast) return false
  const geometry = mesh.geometry
  if (!geometry || !geometry.getAttribute('position')) return false
  const owned = planes.get(geometry)
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  return owned?.position === position && owned.positionVersion === positionVersion(position) &&
    owned.uv === uv && owned.uvVersion === positionVersion(uv) &&
    owned.index === geometry.index && owned.indexVersion === geometry.index?.version &&
    owned.start === geometry.drawRange.start && owned.count === geometry.drawRange.count &&
    geometry.userData[DEFORMED_MARKER] !== true
}

/** Does the material take hits from both faces? */
export function materialIsDoubleSided(mesh: THREE.Mesh): boolean {
  const material = mesh.material
  if (Array.isArray(material)) return material.some((one) => one.side !== THREE.FrontSide)
  return material.side !== THREE.FrontSide
}

/**
 * Measure the geometric conditions: project the pose, then judge facing and
 * on-screen. Only called once the cheap conditions have already allowed
 * native — a rect read forces layout, so this is not free.
 */
function measurePose(input: SurfaceRouteStep, pose: SurfacePose) {
  const view = input.glCanvas.ownerDocument.defaultView
  const rect = input.glCanvas.getBoundingClientRect()
  input.camera.updateMatrixWorld()
  if(!input.renderMatrix)input.mesh.updateWorldMatrix(true, false)
  surfacePose(
    {
      contentWidth: input.contentWidth,
      contentHeight: input.contentHeight,
      mirrorU: false,
      model: (input.renderMatrix ?? input.mesh.matrixWorld).elements,
      view: input.camera.matrixWorldInverse.elements,
      projection: input.camera.projectionMatrix.elements,
      viewportLeft: rect.left,
      viewportTop: rect.top,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    },
    pose,
  )
  return {
    facing: pose.frontFacing || materialIsDoubleSided(input.mesh),
    onScreen: view !== null && poseOnScreen(pose, view.innerWidth, view.innerHeight),
  }
}

/** The native route's conditions that read no layout. */
function couldRide(
  input: SurfaceRouteStep,
  conditions: { hearing: boolean; planar: boolean; exclusiveSource: boolean },
  hasRig: boolean,
): boolean {
  return input.request === 'auto' && input.capable && conditions.hearing &&
    conditions.planar && conditions.exclusiveSource && hasRig
}

/**
 * Does a nearer scene mesh cover `input.mesh` at viewport point (x, y)? The
 * Surface's own plane answers first, so a pointer anywhere else costs one
 * quad intersect and no scene walk.
 */
function coveredAt(input: SurfaceRouteStep, raycaster: THREE.Raycaster, x: number, y: number): boolean {
  const rect = input.glCanvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0 || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false
  input.camera.updateMatrixWorld()
  input.mesh.updateWorldMatrix(true, false)
  raycaster.setFromCamera(
    new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1),
    input.camera,
  )
  const hits: THREE.Intersection[] = []
  THREE.Mesh.prototype.raycast.call(input.mesh, raycaster, hits)
  if (hits.length === 0) return false
  const nearest = Math.min(...hits.map((hit) => hit.distance))
  return sceneMeshCovers(input.mesh, raycaster, nearest)
}

export function createSurfaceRoute(): SurfaceRouteController {
  const pose = createSurfacePose()
  const raycaster = new THREE.Raycaster()
  let obstructed = false
  let listening = false
  const pressesForScene = new Set<number>()
  let swallowClick = false
  const token = Symbol()
  let route: PointerRoute = 'page'
  let rig: NativePointerRig | null = null
  let rigHost: HTMLElement | null = null
  let rigRoot: HTMLElement | null = null
  let rigCursor: HTMLElement | null = null
  // Read once per lift, not per frame: it walks the ancestor chain, and the
  // stacking context a renderer canvas sits in does not move mid-flight.
  let zIndex = 1
  let latest: { input: SurfaceRouteStep; duties: SurfaceRouteRelayDuties } | null = null

  const releaseClaim = () => {
    releaseSourcePointer(rigHost, token)
  }

  const rigFor = (
    host: HTMLElement | null,
    root: HTMLElement | null,
    cursor: HTMLElement,
  ): NativePointerRig | null => {
    if (!host || !root) {
      rig?.park()
      releaseClaim()
      rig = null
      return null
    }
    if (rig && host === rigHost && root === rigRoot && cursor === rigCursor) return rig
    // A source swap while riding would otherwise leave the previous host
    // lifted over the scene with nobody holding its restore values.
    rig?.park()
    releaseClaim()
    zIndex = zIndexAbove(cursor)
    rig = createNativePointerRig(host, root, cursor)
    rigHost = host
    rigRoot = root
    rigCursor = cursor
    return rig
  }

  const controller: SurfaceRouteController = {
    registerSource: (host) => registerSourcePointerPresenter(host, token, () => {
      if (latest) controller.step(latest.input, latest.duties)
    }),
    route: () => route,
    riding: () => rig?.riding() === true,
    release: () => {
      listen(false)
      rig?.park()
      releaseClaim()
      route = 'page'
      latest = null
    },
    step: (input, duties) => apply(input, duties, input.pointer),
  }

  /**
   * One verdict. `pointer` is the place the obstruction is read at; null
   * keeps the last verdict, which is what a held press needs: a mesh that
   * swings in front of a drag in progress must not move the drag between
   * routes.
   */
  function apply(input: SurfaceRouteStep, duties: SurfaceRouteRelayDuties, pointer: SurfaceRouteStep['pointer']): PointerRouteHandoff {
    latest = { input, duties }
    const live = rigFor(input.host, input.root, input.glCanvas)
    const planar = presentsUnitPlane(input.mesh, input.authoredGeometry, input.authoredRaycast)
    const exclusiveSource = sourceHasOnePointerPose(input.host)
    const hearing = input.hearing && input.pointerEvents !== 'none' && !input.root?.closest('[inert]')
    // The free conditions first. Host space reads three rects and builds a
    // matrix, and until 2026-09-29 it did so every frame for presenters that
    // could never ride: any on an engine with no native route, and any
    // asked to relay.
    const eligible = couldRide(input, { hearing, planar, exclusiveSource }, live !== null)
    const space = eligible ? hostSpace(input.host) : null
    const measured = space ? measurePose(input, pose) : { facing: false, onScreen: false }
    listen(eligible)
    if (eligible && pointer && pointer.buttons === 0) obstructed = coveredAt(input, raycaster, pointer.x, pointer.y)

    const next = routeFor({
      request: input.request,
      capable: input.capable,
      hearing,
      exclusiveSource,
      planar,
      facing: measured.facing,
      onScreen: measured.onScreen,
      unobstructed: !obstructed,
    })
    const handoff = pointerRouteHandoff(route, next)
    route = next
    if (handoff.moved) {
      // The law's field order IS the call order: the outgoing route
      // finishes before the incoming one begins, because the relay reads
      // the parked subtree's untransformed layout box and the rig is what
      // transforms it.
      if (handoff.closeRelay) duties.closeRelay()
      if (handoff.park) {
        rig?.park()
        releaseClaim()
      }
      if (handoff.lift) {
        zIndex = zIndexAbove(input.glCanvas)

      }
      if (handoff.rearmRelay) duties.rearmRelay()
      if (handoff.bridgePage) duties.bridgePage()
    }
    // Riding IS the lift — the first ride captures what it replaces and
    // installs the twin listeners, and every later one is the frame's pose.
    // The pose is client-space and the host is fixed to whatever block it
    // was docked in, so it is written in that block's coordinates.
    if (next === 'native' && live && space && rigHost) {
      // One rider per parked host. A source with more than one registered
      // presenter keeps every one of them off the native route
      // (`sourceHasOnePointerPose`): each computes its own pose, so two
      // riders would move the hit region between the copies every frame.
      // The claim parks the host's previous owner, such as page preparation.
      // Source replacement can preserve the route verdict while changing the rig.
      claimSourcePointer(rigHost, token, () => live.park())
      live.ride(nativeRideStyle(inHostSpace(space, pose.matrix), zIndex))
    }
    return handoff
  }

  // A pointer that crosses onto a mesh in front of the lifted canvas must
  // park it before the next event is hit-tested, and a frame is too late:
  // the press that follows the move would land on the HTML behind the mesh.
  // Window capture runs before the page and before trackPointerPlace, so the
  // verdict is read from the event itself.
  const onPointer = (event: PointerEvent) => {
    if (!event.isTrusted || !latest) return
    if (event.type === 'pointerup' || event.type === 'pointercancel') {
      if (pressesForScene.delete(event.pointerId) && insideRig(event.target)) handToScene(event)
      return
    }
    const pressing = event.type === 'pointerdown'
    if (pressing) swallowClick = false
    if (event.buttons !== 0 && !pressing) return
    const { input, duties } = latest
    const covered = coveredAt(input, raycaster, event.clientX, event.clientY)
    if (covered === obstructed) return
    const wasRiding = rig?.riding() === true
    const host = rigHost
    obstructed = covered
    apply(input, duties, null)
    if (!pressing || !covered || !wasRiding || !insideRig(event.target, host)) return
    // A contact with no move before it, such as a touch, was hit-tested
    // against the lifted canvas. The HTML behind the mesh must not see the
    // press, its release, its compatibility mouse events or the click a tap
    // makes from them, so the scene gets the press and its release instead.
    pressesForScene.add(event.pointerId)
    swallowClick = true
    handToScene(event)
  }

  const insideRig = (target: EventTarget | null, host = rigHost): target is Element =>
    target instanceof Element && host?.contains(target) === true

  const handToScene = (event: PointerEvent) => {
    if (!latest || !(event.target instanceof Element)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.target.hasPointerCapture(event.pointerId)) event.target.releasePointerCapture(event.pointerId)
    latest.input.glCanvas.dispatchEvent(new PointerEvent(event.type, event))
  }

  // Preventing a touch press does not cancel the click its tap produces.
  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted || !swallowClick) return
    swallowClick = false
    if (!insideRig(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function listen(on: boolean) {
    if (on === listening) return
    listening = on
    if (on) {
      for (const type of POINTER_TYPES) window.addEventListener(type, onPointer, true)
      window.addEventListener('click', onClick, true)
    } else {
      for (const type of POINTER_TYPES) window.removeEventListener(type, onPointer, true)
      window.removeEventListener('click', onClick, true)
      obstructed = false
      pressesForScene.clear()
      swallowClick = false
    }
  }

  return controller
}
