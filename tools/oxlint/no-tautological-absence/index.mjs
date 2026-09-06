// Ported from kentcdodds/kody tools/oxlint (PR #2090): kody-custom/no-tautological-absence.
import {
	findTautologicalAbsenceMatches,
	isTestPath,
	loadTautologicalAbsenceCorpus,
	locForRange,
	otherContentsFromCorpus,
	repoRelativePath,
} from './tautological-absence.mjs'

// The repo haystack loads once per lint process, then each test file is checked against it.
let tautologicalAbsenceCorpus = null

function tautologicalAbsenceCorpusFor() {
	if (!tautologicalAbsenceCorpus) {
		tautologicalAbsenceCorpus = loadTautologicalAbsenceCorpus()
	}
	return tautologicalAbsenceCorpus
}

const noTautologicalAbsenceRule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Reject instructional-copy not.toContain leftovers when the string exists only as that absence assertion.',
		},
		schema: [],
		messages: {
			vanishedCopy:
				'Do not keep a lone not.toContain of copy that no longer exists in the repo ({{needle}}). Fine while deleting; drop the assertion before commit. Keep absence checks that flip state or still appear on another path.',
		},
	},
	createOnce(context) {
		return {
			Program() {
				const relativePath = repoRelativePath(context.filename)
				if (!isTestPath(relativePath)) return
				const source = context.sourceCode.getText()
				const matches = findTautologicalAbsenceMatches({
					relativePath,
					content: source,
					otherContents: otherContentsFromCorpus(
						tautologicalAbsenceCorpusFor(),
						relativePath,
					),
				})
				for (const match of matches) {
					context.report({
						loc: locForRange(source, match.start, match.end),
						messageId: 'vanishedCopy',
						data: { needle: JSON.stringify(match.needle) },
					})
				}
			},
		}
	},
}

const plugin = {
	meta: { name: 'no-tautological-absence' },
	rules: {
		'no-tautological-absence': noTautologicalAbsenceRule,
	},
}

export default plugin
