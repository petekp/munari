// Confirmed contracts of tools/oxlint custom plugins (anti-slop and no-tautological-absence).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findTautologicalAbsenceMatches,
  isInstructionalCopyNeedle,
} from './no-tautological-absence/tautological-absence.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const oxlintBin = path.join(repoRoot, 'node_modules', '.bin', 'oxlint')
const oxlintConfig = path.join(repoRoot, '.oxlintrc.json')

interface OxlintDiagnostic {
  readonly code: string
  readonly message: string
}

function lintSnippet(filename: string, source: string): OxlintDiagnostic[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'munari-oxlint-'))
  const file = path.join(dir, filename)
  writeFileSync(file, source)
  try {
    const result = spawnSync(oxlintBin, ['-c', oxlintConfig, '--format=json', file], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    if (result.error) throw result.error
    // SAFETY: oxlint --format=json emits an object with a `diagnostics` array on stdout.
    const parsed = JSON.parse(result.stdout) as { diagnostics: OxlintDiagnostic[] }
    return parsed.diagnostics
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('anti-slop plugin (confirmed contracts)', () => {
  it('enforces SAFETY comments on non-const assertions while allowing const assertions', () => {
    const diagnostics = lintSnippet(
      'sample.ts',
      [
        'export const okConst = [1, 2] as const',
        '// SAFETY: verified upstream',
        'const okCast = ("hello" as string).length',
        'const badCast = ("world" as string).length',
        'export const used = [okConst.length, okCast, badCast]',
      ].join('\n'),
    )
    expect(diagnostics.map((d) => d.code)).toEqual(['anti-slop(require-safety-comment-for-type-assertion)'])
  })

  it('rejects module mocking, unknown parameters/returns, and chained assertions', () => {
    const diagnostics = lintSnippet(
      'violations.test.ts',
      [
        'import { expect, it, vi } from "vitest"',
        'vi.mock("./dep")',
        'export function badParam(input: unknown): unknown { return input }',
        'it("checks", () => {',
        '  // SAFETY: test fixture',
        '  const x = (1 as number) as number',
        '  expect(x).toBe(1)',
        '})',
      ].join('\n'),
    )
    const codes = diagnostics.map((d) => d.code)
    expect(codes).toContain('anti-slop(no-module-mocking)')
    expect(codes).toContain('anti-slop(no-unknown-parameters)')
    expect(codes).toContain('anti-slop(no-unknown-returns)')
    expect(codes).toContain('anti-slop(no-chained-type-assertions)')
  })
})

describe('no-tautological-absence (confirmed contracts)', () => {
  it('flags lone absence assertions for vanished instructional copy and allows live or state-flipping copy', () => {
    expect(isInstructionalCopyNeedle('Return to page now', 'Return to page now')).toBe(true)
    expect(isInstructionalCopyNeedle('data-munari-part', 'data-munari-part')).toBe(false)

    const vanished = findTautologicalAbsenceMatches({
      relativePath: 'packages/react/src/example.test.ts',
      content: `expect(output).not.toContain('Legacy banner message removed')`,
      otherContents: [`const current = 'Active banner message'`],
    })
    expect(vanished.map((m) => m.needle)).toEqual(['Legacy banner message removed'])

    const liveElsewhere = findTautologicalAbsenceMatches({
      relativePath: 'packages/react/src/example.test.ts',
      content: `expect(output).not.toContain('Active banner message')`,
      otherContents: [`const current = 'Active banner message'`],
    })
    expect(liveElsewhere).toEqual([])
  })
})
