// Mesh culling — three's frustum test, asked before the draw.
//
// Ownership: SurfaceMesh asks it in development, to report a presenter the
// camera cannot see; three still runs its own test at the draw.

import * as THREE from 'three'

const _viewProjection = new THREE.Matrix4()
const _viewFrustum = new THREE.Frustum()

/**
 * Would the renderer cull this mesh for `camera`? The same frustum test
 * Three runs before a draw. A hidden or layer-masked mesh is not out of view:
 * it is skipped for a reason the author controls.
 */
export function meshOutOfView(mesh: THREE.Mesh, camera: THREE.Camera): boolean {
  if (!mesh.frustumCulled || !camera.layers.test(mesh.layers)) return false
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false
  _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  _viewFrustum.setFromProjectionMatrix(_viewProjection, camera.coordinateSystem, camera.reversedDepth)
  return !_viewFrustum.intersectsObject(mesh)
}
