import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cwd as processCwd } from 'node:process'
import { parseSync } from 'vite'

const skipDirectoryNames = new Set([
	'.agents',
	'.claude',
	'.cursor',
	'.gemini',
	'.git',
	'.scratch',
	'.tmp',
	'.wrangler',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'tmp',
])

const scannedFilePattern = /\.(?:[cm]?[jt]sx?)$/
const testFilePattern = /\.(?:test|spec)\.[^.]+$/
const absenceMatcherPattern =
	/\.not\.(?:toContain|toContainText|toHaveTextContent)\(\s*/g
const presentMatcherPattern =
	/(?<!not)\.(?:toContain|toContainText|toHaveTextContent)\(\s*/g

/** Shared prefix long enough to treat two needles as the same template family. */
export const siblingPrefixLength = 16

const skipDirectoryPrefixes = ['tools/oxlint/']

export function isTestPath(relativePath) {
	return testFilePattern.test(relativePath)
}

export function isInstructionalCopyNeedle(decoded, rawInner) {
	const trimmed = decoded.trim()
	if (!/[A-Za-z]/.test(trimmed) || !/\s/.test(trimmed)) return false
	if (/[<>]/.test(trimmed)) return false
	if (/^&[a-z]+;/i.test(trimmed) || /&[a-z]+;/i.test(trimmed)) return false
	if (/^(data-|href=|action=|id=|class=|aria-|src=|style=)/.test(trimmed)) {
		return false
	}
	if (/^https?:\/\//.test(trimmed)) return false
	if (/<script|javascript:|onerror=/i.test(trimmed)) return false
	if (/\\u[0-9a-f]{4}/i.test(rawInner) || /\\x[0-9a-f]{2}/i.test(rawInner)) {
		return false
	}
	const words = trimmed.split(/\s+/).filter(Boolean)
	const titleCaseLabel =
		words.length === 2 && words.every((word) => /^[A-Z]/.test(word))
	return words.length >= 3 || titleCaseLabel || /[.!?…]$/.test(trimmed)
}

export function longestCommonPrefixLength(left, right) {
	const limit = Math.min(left.length, right.length)
	let index = 0
	while (index < limit && left[index] === right[index]) index += 1
	return index
}

export function repoRelativePath(filename, cwd = processCwd()) {
	if (typeof filename !== 'string' || filename.length === 0) return ''
	if (path.isAbsolute(filename)) {
		return path.relative(cwd, filename).replaceAll('\\', '/')
	}
	return filename.replaceAll('\\', '/')
}

export function indexToLoc(source, index) {
	let line = 1
	let column = 0
	for (let offset = 0; offset < index; offset += 1) {
		if (source[offset] === '\n') {
			line += 1
			column = 0
			continue
		}
		column += 1
	}
	return { line, column }
}

export function locForRange(source, start, end) {
	return {
		start: indexToLoc(source, start),
		end: indexToLoc(source, end),
	}
}

function readQuotedString(source, quoteIndex) {
	const quote = source[quoteIndex]
	if (quote !== "'" && quote !== '"' && quote !== '`') return null
	let index = quoteIndex + 1
	let decoded = ''
	while (index < source.length) {
		const char = source[index]
		if (quote === '`' && char === '$' && source[index + 1] === '{') {
			return null
		}
		if (char === '\\') {
			const escaped = readEscape(source, index + 1)
			if (!escaped) return null
			decoded += escaped.value
			index = escaped.end
			continue
		}
		if (char === quote) {
			return {
				decoded,
				rawInner: source.slice(quoteIndex + 1, index),
				end: index + 1,
			}
		}
		decoded += char
		index += 1
	}
	return null
}

function readEscape(source, index) {
	const char = source[index]
	if (!char) return null
	switch (char) {
		case 'n':
			return { value: '\n', end: index + 1 }
		case 'r':
			return { value: '\r', end: index + 1 }
		case 't':
			return { value: '\t', end: index + 1 }
		case 'b':
			return { value: '\b', end: index + 1 }
		case 'f':
			return { value: '\f', end: index + 1 }
		case 'v':
			return { value: '\v', end: index + 1 }
		case '0':
			return { value: '\0', end: index + 1 }
		case 'x': {
			const hex = source.slice(index + 1, index + 3)
			if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null
			return {
				value: String.fromCharCode(Number.parseInt(hex, 16)),
				end: index + 3,
			}
		}
		case 'u': {
			if (source[index + 1] === '{') {
				const close = source.indexOf('}', index + 2)
				if (close === -1) return null
				const hex = source.slice(index + 2, close)
				if (!/^[0-9a-fA-F]+$/.test(hex)) return null
				return {
					value: String.fromCodePoint(Number.parseInt(hex, 16)),
					end: close + 1,
				}
			}
			const hex = source.slice(index + 1, index + 5)
			if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null
			return {
				value: String.fromCharCode(Number.parseInt(hex, 16)),
				end: index + 5,
			}
		}
		default:
			return { value: char, end: index + 1 }
	}
}

function stripCodeCommentsFallback(source) {
	let out = ''
	let index = 0
	while (index < source.length) {
		const char = source[index]
		const next = source[index + 1]
		if (char === '/' && next === '/') {
			out += '  '
			index += 2
			while (index < source.length && source[index] !== '\n') {
				out += ' '
				index += 1
			}
			continue
		}
		if (char === '/' && next === '*') {
			out += '  '
			index += 2
			while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
				out += source[index] === '\n' ? '\n' : ' '
				index += 1
			}
			if (index < source.length) {
				out += '  '
				index += 2
			}
			continue
		}
		if (char === "'" || char === '"' || char === '`') {
			const quote = char
			out += char
			index += 1
			while (index < source.length) {
				const inner = source[index]
				out += inner
				index += 1
				if (inner === '\\' && index < source.length) {
					out += source[index]
					index += 1
					continue
				}
				if (inner === quote) break
			}
			continue
		}
		out += char
		index += 1
	}
	return out
}

function stripCodeComments(source, filename = 'file.tsx') {
	try {
		const parsed = parseSync(filename, source)
		if (parsed.errors.length === 0) {
			if (parsed.comments.length === 0) return source
			let out = ''
			let cursor = 0
			for (const comment of parsed.comments) {
				out += source.slice(cursor, comment.start)
				for (let i = comment.start; i < comment.end; i += 1) {
					out += source[i] === '\n' ? '\n' : ' '
				}
				cursor = comment.end
			}
			out += source.slice(cursor)
			return out
		}
	} catch {
		// Fall back to character scanner if parser fails.
	}
	return stripCodeCommentsFallback(source)
}

function lineNumberAt(source, index) {
	return source.slice(0, index).split('\n').length
}

export function findContainCalls(content) {
	const stripped = stripCodeComments(content)
	const calls = []
	for (const [kind, pattern] of [
		['absent', absenceMatcherPattern],
		['present', presentMatcherPattern],
	]) {
		pattern.lastIndex = 0
		let match = pattern.exec(stripped)
		while (match) {
			const quoted = readQuotedString(stripped, match.index + match[0].length)
			if (quoted) {
				calls.push({
					kind,
					line: lineNumberAt(stripped, match.index),
					start: match.index,
					end: quoted.end,
					quoted,
				})
			}
			match = pattern.exec(stripped)
		}
	}
	return calls
}

function blankAbsenceSpans(content, needle, calls) {
	let next = content
	for (const call of [...calls].reverse()) {
		if (call.kind !== 'absent' || call.quoted.decoded !== needle) continue
		next = `${next.slice(0, call.start)}${' '.repeat(call.end - call.start)}${next.slice(call.end)}`
	}
	return next
}

function mentionsNeedle(content, needle) {
	return content.includes(needle.decoded) || content.includes(needle.rawInner)
}

function otherFileMentionsNeedle(content, needle) {
	if (!mentionsNeedle(content, needle)) return false
	const stripped = stripCodeComments(content)
	if (!mentionsNeedle(stripped, needle)) return false
	return mentionsNeedle(
		blankAbsenceSpans(stripped, needle.decoded, findContainCalls(stripped)),
		needle,
	)
}

export function findTautologicalAbsenceMatches(input) {
	if (!isTestPath(input.relativePath)) return []
	const stripped = stripCodeComments(input.content)
	const calls = findContainCalls(stripped)
	const presentNeedles = calls
		.filter((call) => call.kind === 'present')
		.map((call) => call.quoted.decoded)
	const matches = []
	const seen = new Set()

	for (const call of calls) {
		if (call.kind !== 'absent') continue
		const { decoded, rawInner } = call.quoted
		if (!isInstructionalCopyNeedle(decoded, rawInner)) continue
		if (seen.has(decoded)) continue
		if (
			presentNeedles.some(
				(present) =>
					longestCommonPrefixLength(present, decoded) >= siblingPrefixLength,
			)
		) {
			continue
		}
		const remainder = blankAbsenceSpans(stripped, decoded, calls)
		if (mentionsNeedle(remainder, { decoded, rawInner })) continue
		if (
			input.otherContents.some((content) =>
				otherFileMentionsNeedle(content, { decoded, rawInner }),
			)
		) {
			continue
		}
		seen.add(decoded)
		matches.push({
			file: input.relativePath,
			line: call.line,
			column: indexToLoc(input.content, call.start).column,
			start: call.start,
			end: call.end,
			needle: decoded,
		})
	}
	return matches
}

function collectScannedFiles(cwd, relativeRoot = '') {
	const matches = []
	const root = path.join(cwd, relativeRoot)
	const stack = [root]
	while (stack.length > 0) {
		const current = stack.pop()
		if (!current) continue
		let entries
		try {
			entries = readdirSync(current, { withFileTypes: true })
		} catch (error) {
			if (
				error instanceof Error &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				continue
			}
			throw error
		}
		for (const entry of entries) {
			const absolutePath = path.join(current, entry.name)
			const relativePath = path
				.relative(cwd, absolutePath)
				.replaceAll('\\', '/')
			if (entry.isDirectory()) {
				if (skipDirectoryNames.has(entry.name)) continue
				if (
					skipDirectoryPrefixes.some((prefix) =>
						`${relativePath}/`.startsWith(prefix),
					)
				) {
					continue
				}
				stack.push(absolutePath)
				continue
			}
			if (!entry.isFile() || !scannedFilePattern.test(entry.name)) continue
			matches.push(relativePath)
		}
	}
	return matches
}

export function listTautologicalAbsencePaths(cwd = processCwd()) {
	return [...new Set(collectScannedFiles(cwd))].sort()
}

export function loadTautologicalAbsenceCorpus(cwd = processCwd()) {
	const contents = new Map()
	for (const relativePath of listTautologicalAbsencePaths(cwd)) {
		contents.set(
			relativePath,
			readFileSync(path.join(cwd, relativePath), 'utf8'),
		)
	}
	return contents
}

export function otherContentsFromCorpus(corpus, relativePath) {
	const otherContents = []
	for (const [candidate, content] of corpus) {
		if (candidate === relativePath) continue
		otherContents.push(content)
	}
	return otherContents
}
