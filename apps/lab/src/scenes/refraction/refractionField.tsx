// The ink field — the leaving page's ink mass, box-filtered to an eighth of
// its own scale and kept in a render target — and the spread grown out of
// it, which is what the aperture front travels along.
//
// The law: nothing optical reads either field. They decide WHERE the drop of
// glass opens and nothing about what it looks like. The page is text, and
// text is a high-frequency signal; a surface cut from it is a relief of
// letterforms, and an arriving page seen through that is torn apart rather
// than bent.
//
// Two faults, both measured 2026-08-22 at full size. First, with the bend
// driven straight off the page's luminance, both documents were legible on
// top of each other across the whole panel — amplitudes 26, 12 and 6 were
// equally bad and only 0 was clean, which is the tell that the magnitude was
// never the problem. Spreading the finite difference to 16px did not fix it
// either: five taps at that spacing over 13px lines is point sampling a
// periodic signal, and the result was colour noise. Filtering to this field
// fixed the noise but not the shape, and Pete's report the same day named
// what was left — the glass was embossed text, with the front merely masking
// it. The surface is now a drop grown off the front itself.
//
// The SPREAD is a second, coarser field, and it is really two: the same ink
// pushed outward a pass at a time until it covers the margins, and the paper
// pushed inward the same way. It exists because the aperture needs an order
// for the parts of a page the ink does not vary over — the empty margins,
// which the circle it used to get that order from ordered visibly as a
// circle, and the insides of solid marks, which nothing ordered at all until
// the second chain. The material takes the difference of the two.
//
// Ownership: this module owns both targets and the passes that fill them.
// The material owns the drop and the front; the tuning owns how coarse the
// field is and how far the spread reaches.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { apertureField, roundedCoord, signedSpread, spreadDecay, spreadPasses } from './refractionLaw'
import { createFieldPass, createSpreadPass } from './refractionNodes'
import { readTargetRows } from '../../lib/passTargets'

/**
 * What the two fields need from a scene's live tuning bag.
 * Named as its own shape so a second scene can drive these passes
 * from its own bag — the gallery's content is photographs, which want a
 * different `apertureDetail` and a different stage box, and nothing else
 * about the passes changes.
 */
export interface FieldConfig {
  fieldPx: number
  spreadPx: number
  spreadReachPx: number
  apertureFloor: number
  apertureCeil: number
  apertureDetail: number
  // These three the PASSES do not use — the material does. They are here
  // because `apertureAt` is here, and it is the shader's own expression:
  // ink mixed with spread, eased across texel boundaries, gamma'd. A field
  // that only knew how to fill its targets could not answer where a
  // pointer landed.
  apertureInk: number
  apertureGamma: number
  frontRounding: number
}

/** A field's own size in texels, for a given CSS px per texel. */
const sizeInTexels = (px: number, stageW: number, stageH: number) => ({
  w: Math.max(4, Math.round(stageW / px)),
  h: Math.max(4, Math.round(stageH / px)),
})

export interface InkField {
  /** The ink field the front's ink term samples. */
  target: THREE.RenderTarget
  /**
   * 1 / spread-field size, so the material can step exactly one spread texel.
   *
   * It measures the front's gradient with a central difference over this,
   * not with `dFdx`. A coarse bilinear texture's screen derivative jumps at
   * every texel boundary — invisible in a seam width, and very visible in a
   * surface normal, which showed as facets on the spread field's own 22px
   * grid (2026-08-22).
   */
  spreadTexel: THREE.Vector2
  /**
   * The ink grown outward, in 0..1, whichever of the ping-pong pair was
   * written last. A uniform slot rather than a texture, because the material
   * re-reads it every frame and the answer alternates.
   */
  spread: { value: THREE.Texture }
  /** The paper grown inward, the same way. The material takes the difference. */
  hollow: { value: THREE.Texture }
  /**
   * `apertureAt` from the fragment shader, on the CPU, for routing a pointer.
   *
   * The fields live only on the GPU, so this reads them back — both spread
   * chains and, when the ink term is mixed in at all, the ink field too.
   * WebGPU has no synchronous read, so the answer comes from the latest
   * completed read: a pointer's question asks for a read after the next
   * frame's passes, and is answered from the previous one. Routing therefore
   * trails the picture by the read's latency, a frame or two, and the empty
   * mirror answers the same value everywhere until the first read lands.
   * Nothing reads unless a pointer asks.
   *
   * The buffers total a few KB — the fields are counted in texels of tens of
   * CSS px, so at the gallery's reference box the two spread targets are
   * 29x18 each.
   */
  apertureAt(u: number, v: number): number
}

function fullscreen(material: THREE.Material) {
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))
  return scene
}

const smallTarget = (w: number, h: number) =>
  new THREE.RenderTarget(w, h, {
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  })

/**
 * Keep both fields up to date, one filter pass and N spread passes a frame.
 *
 * Sized in CSS px rather than off the source's own resolution, so both fields
 * keep the same shape whatever `resolution` the Surface happens to be
 * rasterising at.
 */
export function useInkField(
  source: { value: THREE.Texture | null },
  config: FieldConfig,
  stageW: number,
  stageH: number,
): InkField {
  // Read through a ref, not captured: the panel writes the bag in place and
  // nothing tells this hook, so every frame has to re-read whatever the
  // caller is holding.
  const cfg = useRef(config)
  cfg.current = config
  const stage = useRef({ w: stageW, h: stageH })
  stage.current.w = stageW
  stage.current.h = stageH
  const texels = (px: number) => sizeInTexels(px, stage.current.w, stage.current.h)
  const gl = useThree((state) => state.gl)
  // Fiber types the renderer as WebGLRenderer; SurfaceCanvas supplies a
  // WebGPURenderer, which is what takes a RenderTarget.
  if (!(gl instanceof WebGPURenderer)) throw new Error('The ink field needs the WebGPURenderer from SurfaceCanvas')

  const rig = useMemo(() => {
    const { w, h } = texels(cfg.current.fieldPx)
    const target = smallTarget(w, h)
    // The nodes' source starts as a stand-in; the frame loop points it at the
    // live capture before the first draw.
    const fieldPass = createFieldPass(target.texture)
    fieldPass.step.value.set(1 / (w * 8), 1 / (h * 8))
    fieldPass.detail.value = cfg.current.apertureDetail

    const s = texels(cfg.current.spreadPx)
    const spreadPair = [smallTarget(s.w, s.h), smallTarget(s.w, s.h)] as const
    const hollowPair = [smallTarget(s.w, s.h), smallTarget(s.w, s.h)] as const
    const spreadPass = createSpreadPass(target.texture)
    spreadPass.step.value.set(0.5 / s.w, 0.5 / s.h)

    return {
      target,
      fieldPass,
      scene: fullscreen(fieldPass.material),
      camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      spreadTexel: new THREE.Vector2(1 / s.w, 1 / s.h),
      spreadPair,
      hollowPair,
      spreadPass,
      spreadScene: fullscreen(spreadPass.material),
      spread: { value: target.texture },
      hollow: { value: target.texture },
      // The textures above are what the material samples; these are the
      // same two surfaces as TARGETS, which is what a readback needs.
      spreadTargets: { spread: spreadPair[0], hollow: hollowPair[0] },
      // Reassigned below on every render so the closure sees fresh tuning,
      // while the rig's own identity stays put — the material's uniform bag
      // is memoized on it, and a new rig per render would rebuild that bag
      // every frame of a resize.
      apertureAt: (_u: number, _v: number): number => 0,
    }
  }, [])

  useEffect(
    () => () => {
      rig.target.dispose()
      rig.fieldPass.material.dispose()
      rig.spreadPair.forEach((t) => t.dispose())
      rig.hollowPair.forEach((t) => t.dispose())
      rig.spreadPass.material.dispose()
      for (const scene of [rig.scene, rig.spreadScene]) {
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose()
        })
      }
    },
    [rig],
  )

  // ── the CPU mirror ───────────────────────────────────────────────────
  //
  // One law in two languages. Every line below has a counterpart in
  // the field passes in refractionNodes.ts or in the material's `apertureAt`, and `refractionRouting.test.ts` pins the
  // pair to the same numbers on the same inputs. A change to either without
  // the other is the exact bug this repo is worst at noticing: the picture
  // stays right and only the pointer goes to the wrong document.
  const mirror = useMemo(
    () => ({
      wanted: false,
      pending: false,
      alive: true,
      spread: new Uint8Array(0),
      hollow: new Uint8Array(0),
      ink: new Uint8Array(0),
      w: 0,
      h: 0,
      iw: 0,
      ih: 0,
    }),
    [],
  )

  // Set on mount as well as cleared on unmount: a development remount runs
  // the cleanup first, and a flag only ever cleared drops every later read.
  useEffect(() => {
    mirror.alive = true
    return () => {
      mirror.alive = false
    }
  }, [mirror])

  // Issued after the frame's passes, so it reads this frame's fields. One
  // read at a time; a question asked while one is in flight waits for the
  // next frame.
  const readBack = () => {
    if (!mirror.wanted || mirror.pending) return
    mirror.wanted = false
    mirror.pending = true
    const s = rig.spreadTargets
    // Read only when the ink term is actually mixed in. A gallery reading
    // busyness sets `apertureInk` to 0, and that third read buys nothing.
    const ink = cfg.current.apertureInk > 0 ? rig.target : null
    const reads = [readTargetRows(gl, s.spread), readTargetRows(gl, s.hollow), ink ? readTargetRows(gl, ink) : null] as const
    const size = { w: s.spread.width, h: s.spread.height, iw: ink?.width ?? 0, ih: ink?.height ?? 0 }
    void Promise.all(reads).then(
      ([spread, hollow, inkRows]) => {
        mirror.pending = false
        if (!mirror.alive) return
        mirror.spread = spread
        mirror.hollow = hollow
        mirror.w = size.w
        mirror.h = size.h
        if (inkRows) {
          mirror.ink = inkRows
          mirror.iw = size.iw
          mirror.ih = size.ih
        }
      },
      (error) => {
        mirror.pending = false
        if (mirror.alive) console.error('refraction: field readback failed', error)
      },
    )
  }

  // Bilinear over a readback, matching the targets' own LinearFilter and
  // clamp-to-edge. `readTargetRows` hands back rows from v = 0, the order v
  // already runs, so nothing is flipped here.
  const tap = (buf: Uint8Array, w: number, h: number, u: number, v: number) => {
    if (w === 0 || h === 0) return 0
    const x = u * w - 0.5
    const y = v * h - 0.5
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const cx = (i: number) => Math.min(w - 1, Math.max(0, i))
    const cy = (i: number) => Math.min(h - 1, Math.max(0, i))
    const at = (i: number, j: number) => buf[(cy(j) * w + cx(i)) * 4] / 255
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
    const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
    return top * (1 - fy) + bot * fy
  }

  const apertureAt = (u: number, v: number) => {
    mirror.wanted = true
    const t = cfg.current
    const su = roundedCoord(u, 1 / Math.max(1, mirror.w), t.frontRounding)
    const sv = roundedCoord(v, 1 / Math.max(1, mirror.h), t.frontRounding)
    const spread = signedSpread(
      tap(mirror.spread, mirror.w, mirror.h, su, sv),
      tap(mirror.hollow, mirror.w, mirror.h, su, sv),
    )
    const ink =
      (tap(mirror.ink, mirror.iw, mirror.ih, u, v) - t.apertureFloor) /
      Math.max(1e-4, t.apertureCeil - t.apertureFloor)
    return apertureField(spread, ink, t.apertureInk, t.apertureGamma)
  }

  // Restores whatever target was bound rather than assuming null: this runs
  // inside the frame loop, and a scene that rendered to a target of its own
  // would otherwise find it unbound underneath it.
  useFrame(() => {
    const texture = source.value
    if (!texture?.image) return

    // Resized in place rather than through a dependency: the panel writes
    // the bag and nothing tells this hook, so the check IS the subscription.
    const { w, h } = texels(cfg.current.fieldPx)
    if (rig.target.width !== w || rig.target.height !== h) {
      rig.target.setSize(w, h)
      rig.fieldPass.step.value.set(1 / (w * 8), 1 / (h * 8))
    }
    const s = texels(cfg.current.spreadPx)
    if (rig.spreadPair[0].width !== s.w || rig.spreadPair[0].height !== s.h) {
      rig.spreadPair.forEach((t) => t.setSize(s.w, s.h))
      rig.hollowPair.forEach((t) => t.setSize(s.w, s.h))
      rig.spreadPass.step.value.set(0.5 / s.w, 0.5 / s.h)
      rig.spreadTexel.set(1 / s.w, 1 / s.h)
    }
    const passes = spreadPasses(cfg.current.spreadReachPx, cfg.current.spreadPx)
    const sp = rig.spreadPass
    sp.decay.value = spreadDecay(passes)

    const previous = gl.getRenderTarget()

    rig.fieldPass.detail.value = cfg.current.apertureDetail
    rig.fieldPass.source.value = texture
    gl.setRenderTarget(rig.target)
    gl.render(rig.scene, rig.camera)

    // Ping-pong, run twice: once growing the ink outward and once growing the
    // paper inward. Pass zero reads raw ink heights and normalises them, and
    // is the only pass that inverts; every pass after it reads a field
    // already in 0..1, so its own normalisation has to be the identity.
    const scale = 1 / Math.max(1e-4, cfg.current.apertureCeil - cfg.current.apertureFloor)
    const chain = (pair: readonly THREE.RenderTarget[], invert: number) => {
      let read: THREE.Texture = rig.target.texture
      for (let i = 0; i < passes; i++) {
        sp.floor.value = i === 0 ? cfg.current.apertureFloor : 0
        sp.scale.value = i === 0 ? scale : 1
        sp.invert.value = i === 0 ? invert : 0
        sp.source.value = read
        const write = pair[i % 2]
        gl.setRenderTarget(write)
        gl.render(rig.spreadScene, rig.camera)
        read = write.texture
      }
      return read
    }
    rig.spread.value = chain(rig.spreadPair, 0)
    rig.hollow.value = chain(rig.hollowPair, 1)
    rig.spreadTargets.spread = rig.spreadPair[(passes - 1) % 2]
    rig.spreadTargets.hollow = rig.hollowPair[(passes - 1) % 2]

    gl.setRenderTarget(previous)
    readBack()
  })

  rig.apertureAt = apertureAt

  return rig
}
