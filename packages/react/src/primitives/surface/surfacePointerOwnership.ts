// Capture pointer ownership — one transformed source has one coordinate system.
// The key is the parked host: the node that wears the pose is the node whose
// coordinate system two presenters would be fighting over.
// Decision #39 keeps every scene presenter on the relay when a source has
// several interactive poses. Draw coverage, including sampledParts, is separate.
// Page preparation and scene routing also transfer one rig claim synchronously.
interface Claim { readonly owner: symbol; readonly park: () => void }
const claims = new WeakMap<HTMLElement, Claim>()
const presenters = new WeakMap<HTMLElement, Map<symbol, () => void>>()

export function claimSourcePointer(host: HTMLElement, owner: symbol, park: () => void): void {
  const previous = claims.get(host)
  if (previous?.owner === owner) return
  previous?.park()
  claims.set(host, { owner, park })
}
export function releaseSourcePointer(host: HTMLElement | null, owner: symbol): void {
  if (host && claims.get(host)?.owner === owner) claims.delete(host)
}
export function registerSourcePointerPresenter(host: HTMLElement, owner: symbol, changed: () => void): () => void {
  let owners = presenters.get(host)
  if (!owners) { owners = new Map(); presenters.set(host, owners) }
  owners.set(owner, changed)
  for (const callback of owners.values()) callback()
  return () => {
    if (owners.get(owner) !== changed) return
    owners.delete(owner)
    for (const callback of owners.values()) callback()
  }
}
export function sourceHasOnePointerPose(host: HTMLElement | null): boolean {
  return host !== null && (presenters.get(host)?.size ?? 0) <= 1
}
