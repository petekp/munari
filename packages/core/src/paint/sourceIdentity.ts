let nextSourceId = 0

/** Internal allocator shared by every numbered pixel source. */
export function allocateSourceId(): number {
  return nextSourceId++
}
