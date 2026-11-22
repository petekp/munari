// Canonical documentation link, release-tag, and npm-script integrity check.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BLOB_PREFIX = 'https://github.com/petekp/munari/blob/'
const STAGED_PACKAGE_FILES = new Set([
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'llms.txt',
  '.agents/skills/munari/SKILL.md',
])

const rootPkg: { scripts: Record<string, string> } = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf8'),
)
const reactPkg: { version: string; scripts: Record<string, string> } = JSON.parse(
  readFileSync(join(ROOT, 'packages/react/package.json'), 'utf8'),
)
const labPkg: { scripts: Record<string, string> } = JSON.parse(
  readFileSync(join(ROOT, 'apps/lab/package.json'), 'utf8'),
)

function stripFencedCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '')
}

function subdirReadmes(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, dir, entry.name, 'README.md')))
    .map((entry) => `${dir}/${entry.name}/README.md`)
}

function canonicalDocs(): string[] {
  const docsDir = readdirSync(join(ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`)
  return [
    'AGENTS.md',
    'CLAUDE.md',
    'CONTEXT.md',
    'CHANGELOG.md',
    'README.md',
    'ALL-DEMO-API.md',
    'llms.txt',
    '.agents/skills/munari/SKILL.md',
    'apps/lab/README.md',
    'instruments/README.md',
    'registry/README.md',
    'tests/conformance/README.md',
    'tools/oxlint/anti-slop/README.md',
    'tools/oxlint/no-tautological-absence/README.md',
    ...docsDir,
    ...readdirSync(join(ROOT, 'docs/decisions'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/decisions/${name}`),
    ...subdirReadmes('instruments'),
    ...subdirReadmes('registry'),
  ]
}

function checkBlobTarget(rel: string, rawTarget: string): string[] {
  const errors: string[] = []
  const rest = rawTarget.slice(BLOB_PREFIX.length).split('#')[0] ?? ''
  const slash = rest.indexOf('/')
  const ref = slash >= 0 ? rest.slice(0, slash) : rest
  const repoPath = slash >= 0 ? rest.slice(slash + 1) : ''
  if ((rel === 'README.md' || rel === 'llms.txt') && ref !== `v${reactPkg.version}`) {
    errors.push(`${rel}: expected tag v${reactPkg.version}, got ${rawTarget}`)
  }
  if (repoPath && !existsSync(join(ROOT, repoPath))) {
    errors.push(`${rel}: missing blob target ${repoPath} in ${rawTarget}`)
  }
  return errors
}

function checkDocLink(rel: string, full: string, rawTarget: string): string[] {
  if (!rawTarget || rawTarget.startsWith('#') || rawTarget.startsWith('mailto:')) return []
  if (rawTarget.startsWith(BLOB_PREFIX)) return checkBlobTarget(rel, rawTarget)
  if (/^https?:\/\//.test(rawTarget)) return []
  const pathOnly = rawTarget.split('#')[0] ?? ''
  if (!pathOnly) return []

  if (rel === 'README.md' || rel === 'llms.txt') {
    return STAGED_PACKAGE_FILES.has(pathOnly)
      ? []
      : [`${rel}: unstaged relative link ${rawTarget} (use v${reactPkg.version} GitHub blob URL)`]
  }
  return existsSync(resolve(dirname(full), pathOnly))
    ? []
    : [`${rel}: missing local target ${rawTarget}`]
}

describe('canonical documentation integrity', () => {
  it('resolves all local relative links and GitHub release-tag blob links', () => {
    const broken: string[] = []
    const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g

    for (const rel of canonicalDocs()) {
      const full = join(ROOT, rel)
      const text = stripFencedCode(readFileSync(full, 'utf8'))
      for (const match of text.matchAll(linkPattern)) {
        broken.push(...checkDocLink(rel, full, (match[1] ?? '').trim()))
      }
    }

    expect(broken).toEqual([])
  })

  it('keeps llms.txt version prose aligned with packages/react version', () => {
    const llms = readFileSync(join(ROOT, 'llms.txt'), 'utf8')
    const versions = [...llms.matchAll(/\bv\d+\.\d+\.\d+\b/g)].map((m) => m[0])
    expect(versions.length).toBeGreaterThan(0)
    expect(new Set(versions)).toEqual(new Set([`v${reactPkg.version}`]))
  })

  it('references only defined npm scripts across canonical guides', () => {
    const badScripts: string[] = []
    const scriptPattern = /\bnpm run ([a-z0-9:-]+)(?:\s+-w\s+(@[a-z0-9/-]+))?/g

    for (const rel of canonicalDocs()) {
      if (rel === 'docs/decisions.md' || rel === 'docs/agent-system-plan.md') continue
      const text = readFileSync(join(ROOT, rel), 'utf8')
      for (const match of text.matchAll(scriptPattern)) {
        const script = match[1] ?? ''
        const workspace = match[2]
        const scripts =
          workspace === '@petepetrash/munari'
            ? reactPkg.scripts
            : workspace === '@munari/lab'
              ? labPkg.scripts
              : rootPkg.scripts
        if (!(script in scripts)) {
          badScripts.push(`${rel}: unknown script "${match[0]}"`)
        }
      }
    }

    expect(badScripts).toEqual([])
  })
})
