// Capture pointer ownership — one transformed source has one coordinate system.
// Decision #39 keeps every scene presenter on the relay when a source has
// several interactive poses. Draw coverage, including sampledParts, is separate.
// Page preparation and scene routing also transfer one rig claim synchronously.
interface Claim { readonly owner: symbol; readonly park: () => void }
const claims = new WeakMap<HTMLCanvasElement, Claim>()
const presenters = new WeakMap<HTMLCanvasElement, Map<symbol, () => void>>()

export function claimSourcePointer(canvas: HTMLCanvasElement, owner: symbol, park: () => void): void {
  const previous = claims.get(canvas)
  if (previous?.owner === owner) return
  previous?.park()
  claims.set(canvas, { owner, park })
}
export function releaseSourcePointer(canvas: HTMLCanvasElement | null, owner: symbol): void {
  if (canvas && claims.get(canvas)?.owner === owner) claims.delete(canvas)
}
export function registerSourcePointerPresenter(canvas: HTMLCanvasElement, owner: symbol, changed: () => void): () => void {
  let owners = presenters.get(canvas)
  if (!owners) { owners = new Map(); presenters.set(canvas, owners) }
  owners.set(owner, changed)
  for (const callback of owners.values()) callback()
  return () => {
    if (owners.get(owner) !== changed) return
    owners.delete(owner)
    for (const callback of owners.values()) callback()
  }
}
export function sourceHasOnePointerPose(canvas: HTMLCanvasElement | null): boolean {
  return canvas !== null && (presenters.get(canvas)?.size ?? 0) <= 1
}
