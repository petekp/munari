// Subcommand dispatcher for the public `munari` CLI:
// `init`, `list`, `add`, `compile`, and `check`.
//
// The law: registry presets copy editable source files into the caller's repo
// with no hidden upstream dependency; AOT material compilation emits zero-dep
// `*.material.gen.ts` manifests verified against TypeGPU `typed-binary`.
//
// Ownership: `@petepetrash/munari-cli`.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rewriteManifestImport } from './checkFast.mjs'

const DEFAULT_CONFIG = {
  materialsDir: 'src/materials',
  registryDir: 'src/munari',
  manifestImport: '@petepetrash/munari/gpu',
  includeSource: true,
}

function findRegistryRoot(explicitRegistry) {
  if (explicitRegistry) return path.resolve(process.cwd(), explicitRegistry)
  const localPackaged = path.resolve(import.meta.dirname, '..', 'registry')
  if (existsSync(path.join(localPackaged, 'materials', 'catalog.json'))) return localPackaged
  const monorepoRoot = path.resolve(import.meta.dirname, '..', '..', '..', 'registry')
  if (existsSync(path.join(monorepoRoot, 'materials', 'catalog.json'))) return monorepoRoot
  throw new Error('Could not locate Munari registry directory. Pass --registry <dir>.')
}

function loadConfig(cwd) {
  const cfgPath = path.join(cwd, 'munari.json')
  if (!existsSync(cfgPath)) return { ...DEFAULT_CONFIG }
  return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(cfgPath, 'utf8')) }
}

function loadCatalog(registryRoot) {
  const raw = readFileSync(path.join(registryRoot, 'materials', 'catalog.json'), 'utf8')
  return JSON.parse(raw)
}

function parseFlags(args) {
  const positionals = []
  const flags = {
    dir: '',
    registryDir: '',
    materialsDir: '',
    manifestImport: '',
    registry: '',
    noSource: false,
    source: false,
    force: false,
    deep: false,
    json: false,
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--dir' && args[i + 1]) flags.dir = args[++i]
    else if (a === '--materials-dir' && args[i + 1]) flags.materialsDir = args[++i]
    else if (a === '--registry-dir' && args[i + 1]) flags.registryDir = args[++i]
    else if (a === '--manifest-import' && args[i + 1]) flags.manifestImport = args[++i]
    else if (a === '--registry' && args[i + 1]) flags.registry = args[++i]
    else if (a === '--no-source' || a === '--compiled-only') flags.noSource = true
    else if (a === '--source') flags.source = true
    else if (a === '--force') flags.force = true
    else if (a === '--deep') flags.deep = true
    else if (a === '--json') flags.json = true
    else if (!a.startsWith('-')) positionals.push(a)
    else throw new Error(`Unknown flag: ${a}`)
  }
  return { positionals, flags }
}

function findMaterialFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findMaterialFiles(full))
    else if (entry.name.endsWith('.material.ts')) out.push(full)
  }
  return out.sort()
}

function runInit(args) {
  const cwd = process.cwd()
  const { flags } = parseFlags(args)
  const cfgPath = path.join(cwd, 'munari.json')
  if (existsSync(cfgPath) && !flags.force) {
    throw new Error('munari.json already exists. Pass --force to overwrite.')
  }
  const cfg = {
    materialsDir: flags.materialsDir || flags.dir || DEFAULT_CONFIG.materialsDir,
    registryDir: flags.registryDir || DEFAULT_CONFIG.registryDir,
    manifestImport: flags.manifestImport || DEFAULT_CONFIG.manifestImport,
    includeSource: flags.noSource ? false : DEFAULT_CONFIG.includeSource,
  }
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8')
  console.log(`Initialized ${path.relative(cwd, cfgPath) || 'munari.json'}`)
}

function runList(args) {
  const { flags } = parseFlags(args)
  const registryRoot = findRegistryRoot(flags.registry)
  const catalog = loadCatalog(registryRoot)
  if (flags.json) {
    console.log(JSON.stringify(catalog, null, 2))
    return
  }
  console.log('Materials:')
  for (const m of catalog.materials) {
    const badge = m.needsBackdrop ? ' [backdrop]' : ''
    console.log(`  ${m.name.padEnd(16)} ${m.summary}${badge}`)
  }
  console.log('\nTools & Finishes:')
  for (const t of catalog.tools ?? []) {
    console.log(`  ${t.name.padEnd(16)} ${t.summary}`)
  }
}

function copyPresetFiles(opts) {
  const { name, entry, kind, srcDir, destDir, includeSource, manifestImport, force, cwd } = opts
  mkdirSync(destDir, { recursive: true })
  const copied = []
  const filesToCopy = kind === 'material' ? [`${entry.file}.material.gen.ts`] : entry.files
  if (kind === 'material' && includeSource) filesToCopy.unshift(`${entry.file}.material.ts`)

  for (const fileName of filesToCopy) {
    const src = path.join(srcDir, fileName)
    const dst = path.join(destDir, fileName)
    if (!existsSync(src)) throw new Error(`Missing registry file for ${name}: ${src}`)
    if (existsSync(dst) && !force) {
      throw new Error(`Refusing to overwrite existing ${path.relative(cwd, dst)} (pass --force)`)
    }
    if (fileName.endsWith('.material.gen.ts') && manifestImport !== '@petepetrash/munari/gpu') {
      const srcMaterialPath = path.join(srcDir, `${entry.file}.material.ts`)
      const srcMaterialText = existsSync(srcMaterialPath) ? readFileSync(srcMaterialPath, 'utf8') : ''
      const rewritten = rewriteManifestImport(readFileSync(src, 'utf8'), srcMaterialText, manifestImport)
      writeFileSync(dst, rewritten, 'utf8')
    } else {
      copyFileSync(src, dst)
    }
    copied.push(path.relative(cwd, dst))
  }
  return copied
}

function runAdd(args) {
  const cwd = process.cwd()
  const { positionals, flags } = parseFlags(args)
  if (positionals.length === 0) {
    throw new Error('Usage: munari add <name...> [--dir <path>] [--no-source] [--manifest-import <spec>] [--force]')
  }
  const cfg = loadConfig(cwd)
  const registryRoot = findRegistryRoot(flags.registry)
  const catalog = loadCatalog(registryRoot)
  const materialsByName = new Map(catalog.materials.map((m) => [m.name, m]))
  const toolsByName = new Map((catalog.tools ?? []).map((t) => [t.name, t]))

  const targets = positionals.includes('all') ? catalog.materials.map((m) => m.name) : positionals
  const materialsDest = path.resolve(cwd, flags.materialsDir || flags.dir || cfg.materialsDir)
  const registryDest = path.resolve(cwd, flags.registryDir || flags.dir || cfg.registryDir)
  const manifestImport = flags.manifestImport || cfg.manifestImport
  const includeSource = flags.noSource ? false : flags.source ? true : cfg.includeSource

  const added = []
  for (const name of targets) {
    const mat = materialsByName.get(name)
    if (mat) {
      const files = copyPresetFiles({
        name,
        entry: mat,
        kind: 'material',
        srcDir: path.join(registryRoot, 'materials'),
        destDir: materialsDest,
        includeSource,
        manifestImport,
        force: flags.force,
        cwd,
      })
      added.push({ name, kind: 'material', files })
      continue
    }
    const tool = toolsByName.get(name)
    if (tool) {
      const files = copyPresetFiles({
        name,
        entry: tool,
        kind: 'tool',
        srcDir: path.join(registryRoot, tool.sourceDir),
        destDir: path.join(registryDest, name),
        includeSource: true,
        manifestImport,
        force: flags.force,
        cwd,
      })
      added.push({ name, kind: 'tool', files })
      continue
    }
    throw new Error(`Unknown preset "${name}". Run \`munari list\` to see available items.`)
  }
  console.log(JSON.stringify({ added }, null, 2))
}

async function runCompile(args) {
  const cwd = process.cwd()
  const cfg = loadConfig(cwd)
  const { positionals, flags } = parseFlags(args)
  const files = positionals.length > 0 ? positionals.map((p) => path.resolve(cwd, p)) : findMaterialFiles(cwd)
  if (files.length === 0) throw new Error('No *.material.ts files found.')

  const { compileMaterialFile } = await import('./compiler.mjs')
  const manifestImport = flags.manifestImport || cfg.manifestImport
  const compiled = []
  for (const absPath of files) {
    const res = await compileMaterialFile(absPath, { manifestImport })
    compiled.push({
      name: res.name,
      outPath: path.relative(cwd, res.outPath),
      wgslBytes: res.wgslBytes,
      uniformBytes: res.uniformBytes,
    })
  }
  console.log(JSON.stringify({ compiled }, null, 2))
}

async function runCheck(args) {
  const cwd = process.cwd()
  const cfg = loadConfig(cwd)
  const { positionals, flags } = parseFlags(args)
  const files = positionals.length > 0 ? positionals.map((p) => path.resolve(cwd, p)) : findMaterialFiles(cwd)
  if (files.length === 0) throw new Error('No *.material.ts files found.')

  const manifestImport = flags.manifestImport || cfg.manifestImport
  const checked = []
  if (flags.deep) {
    const { checkMaterialFile } = await import('./compiler.mjs')
    for (const absPath of files) {
      const res = await checkMaterialFile(absPath, { manifestImport })
      checked.push({ name: res.name, outPath: path.relative(cwd, res.outPath), ok: res.ok, reason: res.reason })
    }
  } else {
    const { checkMaterialFileFast } = await import('./checkFast.mjs')
    for (const absPath of files) {
      const res = checkMaterialFileFast(absPath, { manifestImport })
      checked.push({ name: res.name, outPath: path.relative(cwd, res.outPath), ok: res.ok, reason: res.reason })
    }
  }
  console.log(JSON.stringify({ checked }, null, 2))
  if (checked.some((c) => !c.ok)) process.exitCode = 1
}

async function runInfo(args) {
  const cwd = process.cwd()
  const cfg = loadConfig(cwd)
  const { flags } = parseFlags(args)
  const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8'))
  const { getCompilerAbi, checkMaterialFileFast } = await import('./checkFast.mjs')
  const files = findMaterialFiles(cwd)
  const localMaterials = files.map((absPath) => {
    const res = checkMaterialFileFast(absPath, { manifestImport: flags.manifestImport || cfg.manifestImport })
    return { name: res.name, srcPath: path.relative(cwd, absPath), outPath: path.relative(cwd, res.outPath), ok: res.ok, reason: res.reason }
  })
  let catalog = null
  try {
    catalog = loadCatalog(findRegistryRoot(flags.registry))
  } catch {
    catalog = null
  }
  const info = {
    cliVersion: pkg.version,
    manifestVersion: 2,
    compilerAbi: getCompilerAbi(),
    config: cfg,
    frameUniforms: {
      byteSize: 256,
      fields: ['mvp', 'modelWorld', 'size', 'viewport', 'radii', 'camera', 'keyPos', 'keySize', 'rimDir', 'uvRect', '_r1'],
    },
    bindGroups: {
      group0: 'SurfaceFrameUniforms (256B dynamic) + DOM sampler + DOM texture',
      group1: 'Custom uniform struct + optional static textures (e.g. ltc1/ltc2)',
      group2: 'Backdrop sampler + texture when needsBackdrop is true',
    },
    catalog: catalog
      ? { materials: catalog.materials.map((m) => m.name), tools: (catalog.tools ?? []).map((t) => t.name) }
      : null,
    localMaterials,
  }
  console.log(JSON.stringify(info, null, 2))
}

function printHelp() {
  console.log(`munari — ownable materials & tools for Munari

Usage:
  munari init [--materials-dir <dir>] [--registry-dir <dir>] [--manifest-import <spec>] [--no-source]
  munari list [--json]
  munari add <name...> [--dir <dir>] [--no-source] [--force]
  munari compile [files...] [--manifest-import <spec>]
  munari check [files...] [--manifest-import <spec>] [--deep]
  munari info [--json] [--registry <dir>]`)
}

export async function runCli(argv) {
  const [command, ...rest] = argv
  if (!command || command === '-h' || command === '--help') {
    printHelp()
    return
  }
  if (command === 'init') {
    runInit(rest)
    return
  }
  if (command === 'list') {
    runList(rest)
    return
  }
  if (command === 'add') {
    runAdd(rest)
    return
  }
  if (command === 'compile') {
    await runCompile(rest)
    return
  }
  if (command === 'check') {
    await runCheck(rest)
    return
  }
  if (command === 'info') {
    await runInfo(rest)
    return
  }
  throw new Error(`Unknown command "${command}". Run \`munari --help\`.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
