// The shard buffer — one captured row, pre-broken.
//
// The break has to exist in the geometry BEFORE anything moves. A warp
// that pulls a continuous sheet apart always shows rubber at the seams,
// because the seams are not seams: the vertices on either side are the
// same vertices. Splitting the quad first, and giving every piece its own
// centre to spin about, is what makes the motion rigid-body — each shard
// keeps its shape exactly, and the only thing that changes is where it is.
//
// Ownership: this module owns the split. The stagger, the spin rate and
// the gravity are the shader's, driven by the seeds handed out here.

import * as THREE from 'three'

export interface ShardSpec {
  width: number
  height: number
  cols: number
  rows: number
}

/**
 * A grid of loose quads covering the capture.
 *
 * Deliberately a grid and not a Voronoi cracking pattern: at the scale a
 * list row breaks up — 40px tall, gone in 500ms — the eye reads the number
 * of pieces and their motion, and reads nothing at all about their outline.
 * A cell grid buys the same effect for a tenth of the code, and the honest
 * place to spend that saving is on the lighting, which the eye does read.
 */
export function buildShards({ width, height, cols, rows }: ShardSpec): THREE.BufferGeometry {
  const cells = cols * rows
  const position = new Float32Array(cells * 4 * 3)
  const uv = new Float32Array(cells * 4 * 2)
  const center = new Float32Array(cells * 4 * 3)
  const seed = new Float32Array(cells * 4 * 4)
  const index = new Uint32Array(cells * 6)

  const cw = width / cols
  const ch = height / rows
  let v = 0
  let f = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x0 = -width / 2 + i * cw
      const y1 = height / 2 - j * ch
      const cx = x0 + cw / 2
      const cy = y1 - ch / 2
      const s = [Math.random(), Math.random(), Math.random(), Math.random()]
      const base = v
      const corners: readonly (readonly [number, number])[] = [
        [x0, y1 - ch],
        [x0 + cw, y1 - ch],
        [x0 + cw, y1],
        [x0, y1],
      ]
      for (const [px, py] of corners) {
        position[v * 3] = px
        position[v * 3 + 1] = py
        position[v * 3 + 2] = 0
        uv[v * 2] = (px + width / 2) / width
        uv[v * 2 + 1] = (py + height / 2) / height
        center[v * 3] = cx
        center[v * 3 + 1] = cy
        center[v * 3 + 2] = 0
        // One seed per shard, copied to its corners: a seed varying across
        // a quad would send its two triangles different ways and tear it.
        seed[v * 4] = s[0]
        seed[v * 4 + 1] = s[1]
        seed[v * 4 + 2] = s[2]
        seed[v * 4 + 3] = s[3]
        v++
      }
      index[f++] = base
      index[f++] = base + 1
      index[f++] = base + 2
      index[f++] = base
      index[f++] = base + 2
      index[f++] = base + 3
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute('aCenter', new THREE.BufferAttribute(center, 3))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  // Shards leave the row's box immediately, so a fitted sphere would cull
  // the break exactly when it starts.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3000)
  return geometry
}
