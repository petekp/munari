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
  poseMatrix3d,
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

/** Everything one frame's verdict is read from. */
export interface SurfaceRouteStep {
  readonly mesh: THREE.Mesh
  readonly camera: THREE.Camera
  /** The renderer canvas — the viewport the projection lands in. */
  readonly glCanvas: HTMLCanvasElement
  /** The parked capture canvas, null before the runtime exists. */
  readonly parkedCanvas: HTMLCanvasElement | null
  /** The drawn root inside it. */
  readonly root: HTMLElement | null
  readonly request: PointerRouteRequest
  readonly capable: boolean
  readonly hearing: boolean
  readonly mirrorU: boolean
  readonly contentWidth: number
  readonly contentHeight: number
  /** True when the scene supplied its own geometry. */
  readonly authoredGeometry: boolean
  /** True when the scene supplied its own raycast. */
  readonly authoredRaycast: boolean
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
  route: () => PointerRoute
  /** True while the parked canvas is lifted over the renderer canvas. */
  riding: () => boolean
  /** Bring everything down, for teardown. Consults no law. */
  release: () => void
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
  return geometry.userData[DEFORMED_MARKER] !== true
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
  input.mesh.updateWorldMatrix(true, false)
  surfacePose(
    {
      contentWidth: input.contentWidth,
      contentHeight: input.contentHeight,
      mirrorU: input.mirrorU,
      model: input.mesh.matrixWorld.elements,
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

/**
 * Which controller is riding each parked canvas. Two presenters of one
 * source share one parked element, and each computes its own pose — both
 * riding would mean each frame's last writer wins and the hit region
 * teleports between the two copies. First to lift holds the canvas until it
 * parks; every other presenter's native request quietly stays on the relay.
 */
const riders = new WeakMap<HTMLCanvasElement, object>()

export function createSurfaceRoute(): SurfaceRouteController {
  const pose = createSurfacePose()
  const token = {}
  let route: PointerRoute = 'page'
  let rig: NativePointerRig | null = null
  let rigCanvas: HTMLCanvasElement | null = null
  let rigRoot: HTMLElement | null = null
  let rigCursor: HTMLElement | null = null
  // Read once per lift, not per frame: it walks the ancestor chain, and the
  // stacking context a renderer canvas sits in does not move mid-flight.
  let zIndex = 1

  const releaseClaim = () => {
    if (rigCanvas && riders.get(rigCanvas) === token) riders.delete(rigCanvas)
  }

  const rigFor = (
    canvas: HTMLCanvasElement | null,
    root: HTMLElement | null,
    cursor: HTMLElement,
  ): NativePointerRig | null => {
    if (!canvas || !root) {
      rig?.park()
      releaseClaim()
      rig = null
      return null
    }
    if (rig && canvas === rigCanvas && root === rigRoot && cursor === rigCursor) return rig
    // A source swap while riding would otherwise leave the previous canvas
    // lifted over the scene with nobody holding its restore values.
    rig?.park()
    releaseClaim()
    rig = createNativePointerRig(canvas, root, cursor)
    rigCanvas = canvas
    rigRoot = root
    rigCursor = cursor
    return rig
  }

  return {
    route: () => route,
    riding: () => rig?.riding() === true,
    release: () => {
      rig?.park()
      releaseClaim()
      route = 'page'
    },
    step: (input, duties) => {
      const live = rigFor(input.parkedCanvas, input.root, input.glCanvas)
      const planar = presentsUnitPlane(input.mesh, input.authoredGeometry, input.authoredRaycast)
      const holder = input.parkedCanvas ? riders.get(input.parkedCanvas) : undefined
      const unclaimed = holder === undefined || holder === token
      // The conditions the law reads are total, but computing the pose is
      // not free — a rect read forces layout — so the geometric two are only
      // measured when the cheap ones have already allowed native. Reporting
      // them as false when unmeasured cannot change the verdict: every one of
      // them is required for 'native' and none is consulted otherwise.
      const eligible =
        input.request === 'auto' &&
        input.capable &&
        input.hearing &&
        planar &&
        unclaimed &&
        live !== null
      const measured = eligible ? measurePose(input, pose) : { facing: false, onScreen: false }

      const next = routeFor({
        request: input.request,
        capable: input.capable,
        hearing: input.hearing,
        planar,
        facing: measured.facing,
        onScreen: measured.onScreen,
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
          if (rigCanvas) riders.set(rigCanvas, token)
        }
        if (handoff.rearmRelay) duties.rearmRelay()
        if (handoff.bridgePage) duties.bridgePage()
      }
      // Riding IS the lift — the first ride captures what it replaces and
      // installs the twin listeners, and every later one is the frame's pose.
      // The origin is (0, 0): the parked canvas stands at client (0, 0) by
      // the parking law (`position:fixed;left:0;top:0`, paint/htmlInCanvas).
      if (next === 'native' && live) {
        live.ride(nativeRideStyle(poseMatrix3d(pose, 0, 0), zIndex))
      }
      return handoff
    },
  }
}
