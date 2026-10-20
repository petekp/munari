// Pointer state at rest — renders a hover or press without a pointer, through
// the `[data-hover]` and `[data-active]` twins a captured Surface receives
// (docs/authoring.md). The style guide uses it to show every state side by side.

export type PointerState = 'hover' | 'active'

export function pointerAttrs(state: PointerState | undefined) {
  return { 'data-hover': state === 'hover' || undefined, 'data-active': state === 'active' || undefined }
}

export function classes(...names: readonly (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}
