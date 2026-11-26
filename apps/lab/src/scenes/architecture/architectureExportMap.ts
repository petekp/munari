// Munari's export map — every name a published entry of @petepetrash/munari
// exports, with the file that declares it, read from the package source.
//
// The law: the architecture guide lists exactly what the entry files export.
// The reader follows each re-export to its declaration and throws on any form
// it cannot follow (a default export, a bare specifier outside the workspace,
// a name the target does not export), so the build stops instead of the page
// describing an API that changed.
//
// Ownership: this module reads source with node:fs and Vite's parser, at
// build time only. architectureExportMapPlugin.ts serves the result to the
// page as a virtual module; the page imports only its types.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'vite'

export type ExportKind = 'value' | 'type'

export interface PublicExport {
  readonly name: string
  readonly kind: ExportKind
  /** Repository-relative path of the file that declares the name. */
  readonly source: string
  /** The `// ── name ──` rule above the export, or the kernel layer it comes from. */
  readonly section: string | null
}

export interface PublicEntry {
  /** The import specifier, such as `@petepetrash/munari/advanced`. */
  readonly specifier: string
  /** Repository-relative path of the entry file. */
  readonly file: string
  readonly stylesheet: boolean
  readonly exports: readonly PublicExport[]
}

export interface ExportMap {
  readonly packageName: string
  readonly entries: readonly PublicEntry[]
}

export interface ExportMapRead {
  readonly map: ExportMap
  /** Absolute paths of every file the reader opened. */
  readonly files: readonly string[]
}

interface Manifest {
  readonly name: string
  readonly exports: Readonly<Record<string, string>>
}

interface DeclaredExport {
  readonly name: string
  readonly kind: ExportKind
  readonly file: string
  readonly section: string | null
}

const PUBLISHED_PACKAGE_DIR = 'packages/react'
const WORKSPACE_PACKAGES_DIR = 'packages'
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']
const SECTION_RULE = /^\s*── (.+?) ─/
const KERNEL_LAYER = /^packages\/core\/src\/([^/]+)\//

function readManifest(file: string): Manifest {
  const manifest: Manifest = JSON.parse(readFileSync(file, 'utf8'))
  if (!manifest.name || !manifest.exports) {
    throw new Error(`${file} needs a name and an exports map`)
  }
  return manifest
}

function specifierFor(packageName: string, subpath: string): string {
  return subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`
}

export function readExportMap(repoRoot: string): ExportMapRead {
  const opened = new Set<string>()
  const relative = (file: string) => path.relative(repoRoot, file).split(path.sep).join('/')

  const workspace = new Map<string, { dir: string; manifest: Manifest }>()
  for (const entry of readdirSync(path.join(repoRoot, WORKSPACE_PACKAGES_DIR))) {
    const dir = path.join(repoRoot, WORKSPACE_PACKAGES_DIR, entry)
    const manifestFile = path.join(dir, 'package.json')
    if (!existsSync(manifestFile)) continue
    opened.add(manifestFile)
    const manifest = readManifest(manifestFile)
    workspace.set(manifest.name, { dir, manifest })
  }

  function resolveSource(base: string, importer: string, request: string): string {
    if (existsSync(base) && statSync(base).isFile()) return base
    for (const extension of SOURCE_EXTENSIONS) {
      const candidate = base + extension
      if (existsSync(candidate)) return candidate
    }
    throw new Error(`${relative(importer)} re-exports '${request}', and no source file matches it`)
  }

  function resolveRequest(importer: string, request: string): string {
    if (request.startsWith('.')) return resolveSource(path.resolve(path.dirname(importer), request), importer, request)
    for (const [name, { dir, manifest }] of workspace) {
      if (request !== name && !request.startsWith(`${name}/`)) continue
      const target = manifest.exports[`.${request.slice(name.length)}`]
      if (!target) break
      return resolveSource(path.join(dir, target), importer, request)
    }
    throw new Error(`${relative(importer)} re-exports '${request}', which is not a workspace package entry`)
  }

  const declared = new Map<string, readonly DeclaredExport[]>()
  const reading = new Set<string>()

  function exportsOf(file: string): readonly DeclaredExport[] {
    const known = declared.get(file)
    if (known) return known
    if (reading.has(file)) throw new Error(`${relative(file)} is part of a re-export cycle`)
    reading.add(file)
    opened.add(file)

    const parsed = parseSync(file, readFileSync(file, 'utf8'))
    if (parsed.errors.length > 0) {
      throw new Error(`${relative(file)} does not parse: ${parsed.errors.map((error) => error.message).join('; ')}`)
    }
    const rules = parsed.comments
      .filter((comment) => comment.type === 'Line')
      .flatMap((comment) => {
        const match = SECTION_RULE.exec(comment.value)
        return match?.[1] ? [{ start: comment.start, name: match[1] }] : []
      })
    const sectionAt = (offset: number) => rules.filter((rule) => rule.start < offset).at(-1)?.name ?? null

    const found: { readonly at: number; readonly declaration: DeclaredExport }[] = []
    for (const statement of parsed.module.staticExports) {
      const section = sectionAt(statement.start)
      for (const entry of statement.entries) {
        const request = entry.moduleRequest?.value
        const exported = entry.exportName.name
        if (entry.exportName.kind === 'Default') {
          throw new Error(`${relative(file)} has a default export; Munari entries export names only`)
        }
        if (request === undefined) {
          if (!exported) throw new Error(`${relative(file)} has an export the reader cannot name`)
          found.push({ at: entry.start, declaration: { name: exported, kind: entry.isType ? 'type' : 'value', file, section } })
          continue
        }
        const target = resolveRequest(file, request)
        if (entry.importName.kind === 'AllButDefault' && !exported) {
          for (const inner of exportsOf(target)) found.push({ at: entry.start, declaration: { ...inner, section: section ?? inner.section } })
          continue
        }
        if (!exported) throw new Error(`${relative(file)} has an export the reader cannot name`)
        const imported = entry.importName.name
        if (!imported) {
          found.push({ at: entry.start, declaration: { name: exported, kind: 'value', file: target, section } })
          continue
        }
        const declaration = exportsOf(target).find((candidate) => candidate.name === imported)
        if (!declaration) {
          throw new Error(`${relative(file)} re-exports ${imported} from '${request}', which does not export it`)
        }
        const kind = entry.isType || declaration.kind === 'type' ? 'type' : 'value'
        found.push({ at: entry.start, declaration: { name: exported, kind, file: declaration.file, section } })
      }
    }

    const ordered = [...found].sort((a, b) => a.at - b.at).map((item) => item.declaration)
    reading.delete(file)
    declared.set(file, ordered)
    return ordered
  }

  const publishedManifestFile = path.join(repoRoot, PUBLISHED_PACKAGE_DIR, 'package.json')
  opened.add(publishedManifestFile)
  const published = readManifest(publishedManifestFile)
  const entries: PublicEntry[] = Object.entries(published.exports).map(([subpath, target]) => {
    const file = path.join(repoRoot, PUBLISHED_PACKAGE_DIR, target)
    if (!existsSync(file)) throw new Error(`${relative(publishedManifestFile)} exports '${subpath}' from a missing file, ${target}`)
    const specifier = specifierFor(published.name, subpath)
    if (file.endsWith('.css')) {
      opened.add(file)
      return { specifier, file: relative(file), stylesheet: true, exports: [] }
    }
    const names = new Set<string>()
    const exports = exportsOf(file).map((declaration): PublicExport => {
      if (names.has(declaration.name)) throw new Error(`${specifier} exports ${declaration.name} twice`)
      names.add(declaration.name)
      const source = relative(declaration.file)
      const section = declaration.section ?? kernelSection(source)
      return { name: declaration.name, kind: declaration.kind, source, section }
    })
    return { specifier, file: relative(file), stylesheet: false, exports }
  })

  return { map: { packageName: published.name, entries }, files: [...opened] }
}

function kernelSection(source: string): string | null {
  const layer = KERNEL_LAYER.exec(source)?.[1]
  return layer ? `Kernel: ${layer}` : null
}

