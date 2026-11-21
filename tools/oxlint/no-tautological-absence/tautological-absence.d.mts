export interface TautologicalAbsenceMatch {
  readonly needle: string
  readonly start: number
  readonly end: number
}

export function isTestPath(relativePath: string): boolean
export function isInstructionalCopyNeedle(decoded: string, rawInner: string): boolean
export function listTautologicalAbsencePaths(rootDir?: string): string[]
export function loadTautologicalAbsenceCorpus(rootDir?: string): Map<string, string>
export function otherContentsFromCorpus(corpus: Map<string, string>, relativePath: string): string[]
export function findTautologicalAbsenceMatches(input: {
  relativePath: string
  content: string
  otherContents: readonly string[]
}): TautologicalAbsenceMatch[]
