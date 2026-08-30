// Marble-hand asset — the anatomical source, cut at the wrist and sealed.
//
// The law: the index tip is local zero; the wrist is the opposite end.
// A 2026-08-30 colour-axis browser probe exposed a reversed crop: removing
// the lowest Z values cut the index, not the forearm. Bake the proven axis
// here so a model-viewer pivot cannot silently become the cursor hotspot.
//
// Ownership: the CC BY source is documented beside the output. This tool
// owns the reproducible crop; the scene owns material, pose and lighting.
// Run: node apps/lab/tools/make-marble-hand.mjs /path/to/creation-of-adam.glb

import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const sourcePath = process.argv[2]
if (!sourcePath) throw new Error('Pass the Creation of Adam GLB path; see PROVENANCE.md.')
const output = new URL('../public/models/marble-hand/classical-hand.stl', import.meta.url)

// The right-side hand is 250 units from tip to forearm after normalization.
// Removing 35 at the wrist retains the thumb base and all five fingertips.
const SOURCE_LENGTH = 250
const WRIST_TRIM = 35
const CUT_X = -(SOURCE_LENGTH - WRIST_TRIM)
const WELD_PRECISION = 10000

// GLTFLoader reports embedded buffers through the browser progress type.
// Node has no ProgressEvent, but this source has no external texture loads.
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, values = {}) {
    this.type = type
    Object.assign(this, values)
  }
}

const bytes = readFileSync(sourcePath)
const loader = new GLTFLoader()
loader.register((parser) => ({
  name: 'marble-geometry-only',
  beforeRoot() {
    for (const mesh of parser.json.meshes) {
      for (const primitive of mesh.primitives) delete primitive.material
    }
  },
}))
const source = await loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
)
source.scene.updateMatrixWorld(true)
const hand = source.scene.getObjectByName('Other_hand_1')
if (!hand) throw new Error('The licensed source must contain Other_hand_1.')

const pieces = []
hand.traverse((node) => {
  if (!node.isMesh) return
  const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld)
  for (const attribute of Object.keys(geometry.attributes)) {
    if (attribute !== 'position') geometry.deleteAttribute(attribute)
  }
  pieces.push(geometry)
})
const joined = mergeGeometries(pieces)
if (!joined) throw new Error('The source hand could not be joined.')
for (const piece of pieces) piece.dispose()
joined.computeBoundingBox()
const size = joined.boundingBox.getSize(new THREE.Vector3())
const scale = SOURCE_LENGTH / Math.max(size.x, size.y, size.z)
joined.scale(scale, scale, scale)

const positions = joined.getAttribute('position')
const tip = new THREE.Vector3(0, 0, Infinity)
for (let index = 0; index < positions.count; index++) {
  if (positions.getZ(index) < tip.z) tip.fromBufferAttribute(positions, index)
}
joined.translate(-tip.x, -tip.y, -tip.z)
joined.rotateY(-Math.PI / 2)

const triangles = []
const boundary = new Map()
const edges = new Map()
const keyFor = (point) => `${Math.round(point.y * WELD_PRECISION)},${Math.round(point.z * WELD_PRECISION)}`
const addTriangle = (a, b, c) => triangles.push(...a.toArray(), ...b.toArray(), ...c.toArray())

function keepWristSide(polygon) {
  const clipped = []
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const aInside = a.x >= CUT_X
    const bInside = b.x >= CUT_X
    if (aInside) clipped.push(a)
    if (aInside !== bInside) {
      const crossing = a.clone().lerp(b, (CUT_X - a.x) / (b.x - a.x))
      crossing.x = CUT_X
      clipped.push(crossing)
    }
  }
  return clipped
}

const indices = joined.index
for (let index = 0; index < indices.count; index += 3) {
  const polygon = keepWristSide([0, 1, 2].map((offset) =>
    new THREE.Vector3().fromBufferAttribute(positions, indices.getX(index + offset)),
  ))
  for (let corner = 1; corner < polygon.length - 1; corner++) {
    addTriangle(polygon[0], polygon[corner], polygon[corner + 1])
  }
  for (let corner = 0; corner < polygon.length; corner++) {
    const a = polygon[corner]
    const b = polygon[(corner + 1) % polygon.length]
    if (a.x !== CUT_X || b.x !== CUT_X) continue
    const aKey = keyFor(a)
    const bKey = keyFor(b)
    if (aKey === bKey) continue
    boundary.set(aKey, a)
    boundary.set(bKey, b)
    if (!edges.has(aKey)) edges.set(aKey, new Set())
    if (!edges.has(bKey)) edges.set(bKey, new Set())
    edges.get(aKey).add(bKey)
    edges.get(bKey).add(aKey)
  }
}

// Seal the actual cut contour, not an estimated ellipse. A fitted disc
// left light leaks and a broad sheet outside the wrist in the first pass.
const start = edges.keys().next().value
if (!start || [...edges.values()].some((neighbors) => neighbors.size !== 2)) {
  throw new Error('The wrist cut must form one closed ring.')
}
const ring = []
let current = start
let previous
do {
  ring.push(boundary.get(current))
  const next = [...edges.get(current)].find((candidate) => candidate !== previous)
  previous = current
  current = next
} while (current !== start && ring.length <= edges.size)
if (ring.length !== edges.size) throw new Error('The wrist has more than one contour.')

const contour = ring.map((point) => new THREE.Vector2(point.y, point.z))
const cap = THREE.ShapeUtils.triangulateShape(contour, [])
for (const [a, b, c] of cap) {
  const ab = ring[b].clone().sub(ring[a])
  const ac = ring[c].clone().sub(ring[a])
  if (ab.cross(ac).x > 0) addTriangle(ring[a], ring[c], ring[b])
  else addTriangle(ring[a], ring[b], ring[c])
}

const geometry = new THREE.BufferGeometry()
geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3))
geometry.computeVertexNormals()
geometry.computeBoundingBox()
const mesh = new THREE.Mesh(geometry)
const data = new STLExporter().parse(mesh, { binary: true })
writeFileSync(output, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
console.log(JSON.stringify({
  output: output.pathname,
  triangles: triangles.length / 9,
  wristVertices: ring.length,
  capTriangles: cap.length,
  bytes: data.byteLength,
  bounds: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() },
}, null, 2))
joined.dispose()
geometry.dispose()
