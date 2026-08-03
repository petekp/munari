// The conformance ledger — live from first commit. Contract files
// (*.contract.ts) are typechecked but invisible to the runner until
// their layer lands (README.md, decisions.md #2). This suite is what
// keeps that honest: every contract shows up as a todo on every run,
// and the conventions that make contracts safe are enforced, not
// described.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)))
const ROOT = resolve(HERE, '../..')
const LAYERS = ['mapping', 'paint', 'door', 'transfer', 'chrome', 'physics']

function walk(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

type Contract = {
  file: string // repo-relative
  layer: string // directory under conformance/
  header: string // line 1
  origin: string // line 2
  text: string
}

const contracts: Contract[] = walk(HERE)
  .filter((f) => f.endsWith('.contract.ts'))
  .map((f) => {
    const text = readFileSync(f, 'utf8')
    const [header = '', origin = ''] = text.split('\n')
    return {
      file: relative(ROOT, f),
      layer: basename(dirname(f)),
      header,
      origin,
      text,
    }
  })

describe('conformance ledger — contracts awaiting their layer', () => {
  for (const c of contracts) {
    it.todo(`${c.layer}/${basename(c.file, '.contract.ts')} — ${c.origin.replace(/^\/\/\s*/, '')}`)
  }

  it('contract directories are the six kernel layers, nothing else', () => {
    const strays = contracts.filter((c) => !LAYERS.includes(c.layer))
    expect(strays.map((c) => c.file)).toEqual([])
  })

  it('every contract file follows the header convention', () => {
    for (const c of contracts) {
      // Line 1 names the layer it lives under; line 2 is provenance.
      expect(c.header, c.file).toMatch(
        new RegExp(`^// CONFORMANCE CONTRACT — ${c.layer} \\(typechecked, not yet run\\)$`),
      )
      expect(
        /^\/\/ (Ported from three-ui@362c5a1 |New contract \(owed by seed manifest\))/.test(c.origin),
        `${c.file}: line 2 must be a "Ported from" or "New contract" line, got: ${c.origin}`,
      ).toBe(true)
      expect(c.text, `${c.file}: must cite archive#N`).toContain('archive#')
      expect(c.text, `${c.file}: must declare its surface under a CONTRACT HOLES marker`).toContain(
        '// ---- CONTRACT HOLES',
      )
    }
  })

  it('no contract imports @anamorph/core — the import arriving IS the flip', () => {
    // A contract that imports the kernel has outlived its name: the flip
    // protocol says rename to .test.ts in the same change (README.md).
    const offenders = contracts.filter((c) => /from\s+['"]@anamorph\/core/.test(c.text))
    expect(offenders.map((c) => c.file)).toEqual([])
  })

  it('nothing in the repo imports the oracle', () => {
    // three-ui is checked out next door for diffing and probing — cited,
    // never imported (CLAUDE.md). Specifier-level ban, all source trees.
    const offenders: string[] = []
    for (const tree of ['tests', 'packages', 'apps', 'registry', 'instruments']) {
      for (const f of walk(join(ROOT, tree))) {
        if (!/\.tsx?$/.test(f)) continue
        const text = readFileSync(f, 'utf8')
        for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
          if ((m[1] as string).includes('three-ui')) offenders.push(relative(ROOT, f))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
