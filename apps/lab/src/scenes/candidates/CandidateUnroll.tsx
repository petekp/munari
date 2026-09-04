// Candidate 3 — the menu that unrolls.
//
// Open the dropdown and the panel does not fade, scale, or slide: it is a
// sheet wound on a roll, and the roll travels down the page paying out
// material as it goes. Close it and the roll runs back up, taking the
// items with it. At every moment in between, the part that is flat is a
// real menu — hoverable, clickable, keyboard-reachable through the relay —
// and the part that is wound is the same menu, wound.
//
// The winding is CPU work on the vertices, not a vertex shader, and that
// is the whole reason the menu is usable mid-roll. three raycasts CPU
// geometry: warp only the pixels and the hit test stays on the flat sheet,
// so a row responds where it USED to be — off by the full displacement,
// which near the roll is the height of two rows. Fisheye is named after
// this fault; the escape is the same one, and the bounding sphere has to
// be dropped every frame or three rejects the ray before uv routing runs.
//
// Why a roll and not a fold: arc length. A rolled sheet is inextensible —
// see candidateCurlLaw.ts — so the text near the hinge does not stretch as
// it goes round, which is the difference between paper and rubber and the
// only thing that makes the material read as a material.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, useSurfaceChrome, useSurfaceHandle, useSurfaceState, useSurfaceTexture } from '@petepetrash/munari'
import { textureSlot } from '../../lib/uniforms'
import { curlSample, unrolledLength } from './candidateCurlLaw'
import { LIGHT, SHEET_FRAG, SHEET_VERT } from './candidateShaders'
import { plainAttribute } from '../../lib/geometry'
import { useOwnUniforms, type WorldBox } from './candidateStage'
import { unrollTuning } from './candidateTuning'

const ITEMS = ['Duplicate', 'Move to…', 'Rename', 'Export PDF', 'Share link', 'Delete'] as const
const ROW_H = 38
const MENU_W = 232
const MENU_PAD = 6
const MENU_H = ITEMS.length * ROW_H + MENU_PAD * 2

// Core radius, ply, and the ease's time constant live in unrollTuning —
// a tighter core than ~13px shows facets at this tessellation, and turns
// nested closer than ~1px draw as the single-ring mush the curl law's
// preamble records.
// Vertical resolution. One vertex every ~2px of sheet: the tightest
// curvature the roll ever reaches is 1/RADIUS, and a 2px chord across a
// 13px radius is a 9° step, which is under the shading's visible banding
// threshold.
const GRID_Y = Math.round(MENU_H / 2)
const GRID_X = 2

function SheetMaterial({ opacity }: { opacity: { value: number } }) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uLightDir: { value: new THREE.Vector3(...LIGHT) },
      // The back of the sheet, in the lab's own paper stock. Anything
      // darker reads as a shadow rather than as the other side of a page.
      uBackColor: { value: new THREE.Color('#e6e3d4') },
      uShade: { value: unrollTuning.shade },
      uOpacity: opacity,
      uMunariRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMunariSize: { value: new THREE.Vector2(1, 1) },
    }),
    [opacity],
  )
  uniforms.tMap.value = texture
  const material = useOwnUniforms(uniforms)
  const radii = chrome?.radii ?? [0, 0, 0, 0]
  uniforms.uMunariRadii.value.set(radii[0], radii[1], radii[2], radii[3])
  uniforms.uMunariSize.value.set(width, height)
  useFrame(() => {
    uniforms.uShade.value = unrollTuning.shade
  })
  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={SHEET_VERT}
      fragmentShader={SHEET_FRAG}
      transparent
      premultipliedAlpha
      // Depth is the only occlusion between the turns of the roll: the
      // sheet overlaps itself three layers deep when wound, and without
      // the depth buffer every wound row's text blends into one garble on
      // the coil's face (2026-08-20). The cost is the usual transparent-
      // writer artifact, confined to the corner-radius pixels.
      depthWrite
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

/** What the page half is asking the sheet to do. */
export interface RollDrive {
  /** 1 open, 0 closed. */
  target: number
  t: number
}

/**
 * The winding, applied to real vertices every live frame.
 *
 * Normals are written here too rather than left to `computeVertexNormals`:
 * the law already knows the exact normal at every point of the curl, and
 * re-deriving it from the triangles it just produced would be both slower
 * and blunter at the hinge, where the two answers differ most.
 */
function RollSheet({
  drive,
  geoRef,
  opacity,
  onClosed,
}: {
  drive: React.RefObject<RollDrive>
  geoRef: React.RefObject<THREE.PlaneGeometry | null>
  /** The sheet material's uOpacity slot, written here so one loop owns t. */
  opacity: { value: number }
  onClosed: () => void
}) {
  // The rest is an edge, not a state: without this the drop would be
  // requested on every frame the menu spends closed, and each one is a
  // fresh view change through the protocol. It starts TRUE because the
  // menu starts closed — and because the open gate holds target at 0
  // until the canvas presents, so the first frames after a click look
  // exactly like rest. 2026-08-20: starting false dropped the lift on
  // frame one and the menu never appeared at all.
  const rested = useRef(true)
  useFrame((_, delta) => {
    const d = drive.current
    const dt = Math.min(delta, 1 / 30)
    d.t += (d.target - d.t) * (1 - Math.exp(-dt / unrollTuning.tau))
    if (Math.abs(d.target - d.t) < 0.001) d.t = d.target

    // The last of the close: the wound coil tucks away behind the trigger
    // over the final 8% rather than blinking out on the unmount. Open is
    // never dimmed — t leaves 0.08 within two frames.
    opacity.value = d.target === 0 ? Math.min(1, d.t / 0.08) : 1

    const geometry = geoRef.current
    if (geometry) {
      const pos = plainAttribute(geometry, 'position')
      const nrm = plainAttribute(geometry, 'normal')
      const uv = plainAttribute(geometry, 'uv')
      if (pos && nrm && uv) {
        const flat = unrolledLength(d.t, MENU_H)
        for (let i = 0; i < pos.count; i++) {
          // uv.y runs bottom → top; arc length runs from the anchored top
          // edge, which is the edge pinned under the trigger.
          const s = (1 - uv.getY(i)) * MENU_H
          const c = curlSample(s, flat, MENU_H, unrollTuning.radius, unrollTuning.ply)
          pos.setY(i, MENU_H / 2 - c.along)
          pos.setZ(i, c.lift)
          nrm.setXYZ(i, 0, -c.normalAlong, c.normalLift)
        }
        pos.needsUpdate = true
        nrm.needsUpdate = true
        // Three caches this on the first raycast. The sheet is a different
        // shape every frame while the roll travels, and the flat sphere
        // would reject rays at the roll's bulge before uv routing ran.
        geometry.boundingSphere = null
      }
    }

    if (d.target !== 0) rested.current = false
    else if (d.t === 0 && !rested.current) {
      rested.current = true
      onClosed()
    }
  })
  return null
}

export function CandidateUnroll() {
  const surface = useSurfaceHandle('unroll-menu')
  const state = useSurfaceState(surface)
  const [presenting, setPresenting] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [box, setBox] = useState<WorldBox | null>(null)
  const geoRef = useRef<THREE.PlaneGeometry>(null)
  const drive = useRef<RollDrive>({ target: 0, t: 0 })
  const sheetOpacity = useRef({ value: 1 }).current

  // The unroll may not start until the canvas actually presents. The ease
  // used to start at the click, while the capture was still lifting — by
  // the first frame anyone could SEE, t had already reached ~0.7 and the
  // menu appeared mid-unroll. Closing is ungated: the pixels are already
  // in GL.
  drive.current.target = open && state.presented === 'canvas' ? 1 : 0

  // The menu hangs from the trigger's bottom edge, so the mesh's centre is
  // half a menu below it. Measured on open rather than on mount: the page
  // is scrollable and the trigger does not promise to stay put.
  const place = useCallback(() => {
    const el = anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setBox({
      x: r.left + MENU_W / 2 - window.innerWidth / 2,
      y: window.innerHeight / 2 - (r.bottom + 6 + MENU_H / 2),
      w: MENU_W,
      h: MENU_H,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, place])

  const toggle = useCallback(() => setOpen((was) => !was), [])

  // Outside the updater: an updater runs under React's replay rules, and a
  // side effect inside one is allowed to be dropped or doubled.
  useLayoutEffect(() => {
    if (open) setPresenting(true)
  }, [open])

  const pick = useCallback((item: string) => {
    setChosen(item)
    setOpen(false)
  }, [])

  const menu = (
    <div className="cand-menu" style={{ width: MENU_W, padding: MENU_PAD }}>
      {ITEMS.map((item) => (
        <button
          key={item}
          type="button"
          className="cand-menu__item"
          style={{ height: ROW_H }}
          data-danger={item === 'Delete' || undefined}
          onClick={() => pick(item)}
        >
          {item}
        </button>
      ))}
    </div>
  )

  return (
    <div className="cand-page cand-page--center">
      <div className="cand-card cand-card--menu">
        <header>
          <h2>Document</h2>
          <p>{chosen ? `Last action: ${chosen}` : 'No action yet.'}</p>
        </header>
        <button ref={anchor} type="button" className="cand-btn" onClick={toggle} aria-expanded={open}>
          Actions
          <span className="cand-caret" data-open={open || undefined} aria-hidden />
        </button>
      </div>

      <Surface
          surface={surface}
          renderIn={presenting ? 'canvas' : 'none'}
          timing={{ settleMs: 0, durationMs: 1 }}
          size={[MENU_W, MENU_H]}
          source={menu}
        >
          {/* The page copy exists to be measured and to hold the rows'
              identity; it is never the visible one, because a menu is only
              ever on screen while the sheet is in GL. It is parked out of
              flow so an unrolling menu does not push the card around. */}
          <div className="cand-menu-park">
            <Surface.DOM />
          </div>
          {box && (
            <Surface.Mesh
              placement="manual"
              alpha="source"
              frustumCulled={false}
              position={[box.x, box.y, 0]}
              pointerEvents="content"
              geometry={<planeGeometry ref={geoRef} args={[MENU_W, MENU_H, GRID_X, GRID_Y]} />}
              material={<SheetMaterial opacity={sheetOpacity} />}
            >
              <RollSheet drive={drive} geoRef={geoRef} opacity={sheetOpacity} onClosed={() => setPresenting(false)} />
            </Surface.Mesh>
          )}
        </Surface>
    </div>
  )
}
