// Probe source edits — one required match before a measurement can run.
// A spacing-only change removed the lamp freeze control (2026-09-07).
// Missing or ambiguous observation points must stop the instrument.
import assert from 'node:assert/strict'

export function replaceSource(source, marker, replacement) {
  const index = source.indexOf(marker)
  assert.ok(index >= 0, `Probe source marker missing: ${JSON.stringify(marker)}`)
  assert.equal(source.indexOf(marker, index + marker.length), -1, `Probe source marker is ambiguous: ${JSON.stringify(marker)}`)
  return source.replace(marker, replacement)
}
