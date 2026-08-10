import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A parked subtree keeps :root's custom properties but inherits the
// parking HOST's font, not the page's. So a scene's font declarations
// must be self-contained — and there is a trap that makes them silently
// not be: the lab's type tokens (--display, --body, --label) are
// font-FAMILY lists, and a `font:` shorthand needs at least a size and
// a family to be valid. `font: var(--body)` substitutes to a bare
// family list, which is invalid at computed-value time, and an invalid
// shorthand does not error — it inherits. On the page that inheritance
// bottoms out at body's `font-family: var(--body)` and looks correct;
// in the parked copy it bottoms out at the host's default stack, and
// the texture comes up in the wrong face (found in the genie scene,
// 2026-08-08: page Archivo, parked -apple-system).
//
// Valid forms carry the size with the family: `font: 600 11px/1
// var(--label)`. This test rejects the bare-var shorthand everywhere in
// the lab's stylesheets so the mistake cannot come back quietly.

const SRC = join(__dirname, '..')

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.css'))
    .map((e) => join(e.parentPath, e.name))
}

describe('font declarations survive parking', () => {
  it('no font: shorthand is a bare var() of a family token', () => {
    const offenders: string[] = []
    for (const file of cssFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/(?:^|[\s;{])font:\s*var\(--[\w-]+\)\s*(?:!important\s*)?;/.test(line)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim()}`)
        }
      })
    }
    expect(offenders, 'invalid font shorthands (family token alone — inherits instead)').toEqual(
      [],
    )
  })
})
