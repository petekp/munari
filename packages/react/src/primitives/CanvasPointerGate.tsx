import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { isRelayed } from '@munari/core'

export interface CanvasPointerGateProps {
  enabled?: boolean
  isTarget: (object: THREE.Object3D) => boolean
}

/**
 * Keep a full-page R3F canvas clear except where selected scene matter exists.
 * It also gives a cold touch or pen contact one route into R3F before the
 * browser has had a pointer move with which to arm the canvas.
 *
 * Three guards, each a paid-for interaction contract:
 * - `claims`: from a pointerdown on matter until its release, every event
 *   of that pointerId is retargeted through the canvas, so a drag that
 *   leaves the canvas cannot strand the Surface's active pointer
 *   mid-gesture, and the release is delivered even when the browser's
 *   hit target has moved on.
 * - the per-frame target cache: arming events raycast against the scene's
 *   matter, so the traversal is built once per frame, not once per
 *   pointermove.
 * - `suppressedClick`: a claimed contact was already delivered to the
 *   scene, but the browser still synthesizes a click from the same
 *   press; a click within 8 px of the contact point is swallowed while
 *   the window is open. The window expires (1 s) so a later, unrelated
 *   click at the same spot is not eaten.
 *
 * Relayed events (`isRelayed`) and this gate's own clones (`routed`) pass
 * untouched — the gate must not re-route what the relay already routed.
 */
export function CanvasPointerGate({
  enabled = true,
  isTarget,
}: CanvasPointerGateProps) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const events = useThree((state) => state.events)
  const targetTestRef = useRef(isTarget)
  targetTestRef.current = isTarget

  useEffect(() => {
    const canvas = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const claims = new Map<number, PointerEvent>()
    const routed = new WeakSet<Event>()
    let cachedTargets: THREE.Object3D[] = []
    let clearTargetCacheFrame = 0
    let suppressedClick: { x: number; y: number; until: number } | null = null

    let lastArm: PointerEvent | null = null
    let recheckFrame = 0

    const setSolid = (solid: boolean) => {
      canvas.style.pointerEvents = solid ? 'auto' : 'none'
      if (solid) startRecheck()
      else if (recheckFrame) {
        cancelAnimationFrame(recheckFrame)
        recheckFrame = 0
      }
    }

    // Matter can vanish beneath a STILL pointer — an exclusive Surface lands
    // and its mesh's raycast starts declining — and with no trusted move to
    // re-arm, the canvas stayed solid over nothing: the browser's hover
    // recompute hit the canvas instead of the restored page copy, and a
    // motionless follow-up click died on it (measured 2026-08-20). While
    // solid and unclaimed, re-ask the raycast each frame at the last armed
    // position. Runs only while the pointer is over Surface matter; one
    // quad intersect per frame, no paints, so gate:idle-zero holds.
    const startRecheck = () => {
      if (recheckFrame) return
      recheckFrame = requestAnimationFrame(function step() {
        recheckFrame = 0
        if (canvas.style.pointerEvents === 'none') return
        if (claims.size === 0 && lastArm && !hitsTarget(lastArm)) {
          setSolid(false)
          return
        }
        recheckFrame = requestAnimationFrame(step)
      })
    }

    const targetsThisFrame = () => {
      if (clearTargetCacheFrame === 0) {
        cachedTargets = []
        scene.traverse((object) => {
          if (targetTestRef.current(object)) cachedTargets.push(object)
        })
        clearTargetCacheFrame = requestAnimationFrame(() => {
          clearTargetCacheFrame = 0
          cachedTargets = []
        })
      }
      return cachedTargets
    }

    const hitsTarget = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        return false
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      camera.updateMatrixWorld()
      scene.updateMatrixWorld()
      raycaster.setFromCamera(ndc, camera)
      return raycaster.intersectObjects(targetsThisFrame(), false).length > 0
    }

    const clone = (event: PointerEvent, type = event.type) => {
      const copy = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
        pressure: event.pressure,
        width: event.width,
        height: event.height,
        tiltX: event.tiltX,
        tiltY: event.tiltY,
        twist: event.twist,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        view: window,
      })
      routed.add(copy)
      return copy
    }

    const routeThroughR3f = (event: PointerEvent, type = event.type) => {
      canvas.dispatchEvent(clone(event, type))
    }

    const clearR3fHover = (sample?: PointerEvent) => {
      const event = sample
        ? clone(sample, 'pointerleave')
        : new PointerEvent('pointerleave', { bubbles: false, pointerId: 1 })
      events.handlers?.onPointerLeave?.(event)
    }

    const finishClaim = (pointerId: number, sample?: PointerEvent) => {
      claims.delete(pointerId)
      if (claims.size === 0) {
        clearR3fHover(sample)
        setSolid(false)
      }
    }

    const cancelClaims = () => {
      for (const [pointerId, sample] of claims) {
        routeThroughR3f(sample, 'pointercancel')
        finishClaim(pointerId, sample)
      }
      claims.clear()
      clearR3fHover()
      setSolid(false)
    }

    const arm = (event: PointerEvent) => {
      if (isRelayed(event) || routed.has(event)) return
      lastArm = event
      if (claims.has(event.pointerId)) {
        setSolid(true)
        return
      }
      if (event.buttons !== 0 && event.type === 'pointermove') return
      setSolid(hitsTarget(event))
    }

    const onDown = (event: PointerEvent) => {
      if (isRelayed(event) || routed.has(event) || !hitsTarget(event)) return
      claims.set(event.pointerId, event)
      setSolid(true)
      suppressedClick = {
        x: event.clientX,
        y: event.clientY,
        until: performance.now() + 1000,
      }
      if (event.target === canvas) return
      if (event.target instanceof Node && canvas.contains(event.target)) return

      // The page received the cold contact because the canvas was clear.
      // Retarget this one event through R3F and stop the false page story.
      event.preventDefault()
      event.stopImmediatePropagation()
      routeThroughR3f(event)
    }

    const onClaimed = (event: PointerEvent) => {
      if (isRelayed(event) || routed.has(event) || !claims.has(event.pointerId)) return
      setSolid(true)
      // Once claimed, R3F receives one coordinate-correct event regardless
      // of the browser's current hit target. This also keeps a release that
      // occurs off the canvas from stranding the Surface's active pointer.
      event.preventDefault()
      event.stopImmediatePropagation()
      routeThroughR3f(event)
      if (event.type === 'pointerup' || event.type === 'pointercancel') {
        const sample = event
        queueMicrotask(() => finishClaim(event.pointerId, sample))
      }
    }

    const onClick = (event: MouseEvent) => {
      const pending = suppressedClick
      if (!pending || performance.now() > pending.until) {
        suppressedClick = null
        return
      }
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) return
      event.preventDefault()
      event.stopImmediatePropagation()
      suppressedClick = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancelClaims()
    }

    if (!enabled) {
      cancelClaims()
      return cancelClaims
    }

    document.addEventListener('pointerover', arm, true)
    document.addEventListener('pointermove', arm, true)
    document.addEventListener('pointerdown', onDown, { capture: true, passive: false })
    document.addEventListener('pointermove', onClaimed, { capture: true, passive: false })
    document.addEventListener('pointerup', onClaimed, { capture: true, passive: false })
    document.addEventListener('pointercancel', onClaimed, { capture: true, passive: false })
    document.addEventListener('click', onClick, true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', cancelClaims)
    return () => {
      document.removeEventListener('pointerover', arm, true)
      document.removeEventListener('pointermove', arm, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onClaimed, true)
      document.removeEventListener('pointerup', onClaimed, true)
      document.removeEventListener('pointercancel', onClaimed, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', cancelClaims)
      if (clearTargetCacheFrame) cancelAnimationFrame(clearTargetCacheFrame)
      cancelClaims()
    }
  }, [camera, enabled, events, gl, scene])

  return null
}
