# docs

Start with the document that answers the task. A design proposal is not proof
of implemented behavior. A source implementation is not proof of browser
output. Preserve both distinctions when resolving a conflict.

| Need | Canonical home | Status |
|---|---|---|
| Set up and use the package | [Root README](../README.md), public entry types | Current usage |
| Find the owner, control and relevant check | [Agent operating guide](agent-workflow.md) | Current workflow |
| Understand how the abstractions fit | [System model](system-model.md), [glossary](../CONTEXT.md) | Current model and constraints |
| Build the next agent-facing capability | [Agent system plan](agent-system-plan.md) | Work in progress; unbuilt stages are explicit |
| Understand an architectural choice | [Decisions](decisions.md) | Numbered decisions with dated amendments |
| Check a browser-specific claim | [Platform](platform.md), [instruments](../instruments/README.md) | Measurements under the recorded conditions |
| Write captured HTML | [Authoring](authoring.md) | Current rules derived from measurements |
| Implement focus and spatial navigation | [Focus](focus.md) | Contract, implemented in the binding |
| Check a kernel law | [Conformance suites](../tests/conformance/README.md) | Executable specification |
| Recover the API design process | [Revision 3 proposal](public-api-proposal.md), [compound sketches](compound-api-sketches.md) | Historical, not implementation instructions |
| Recover the Surface API revision | [API naming proposal](api-naming-proposal.md), [decision #40](decisions.md) | Proposal is historical; decision records implementation and local verification |

Code comments cite `decisions.md #N` and `platform.md #N`; numbering never
changes. Decision entries retain their original text, with dated amendments
for changes. A new measurement records its conditions and probe instead of
silently changing a threshold. If code, a contract and a browser result
disagree, record the conflict and run the smallest discriminating check.

Keep usage in the current guide, reasoning in the decision, and unbuilt work
in the plan. Link these homes rather than maintaining several versions of the
same rule. Package-local availability remains a separate concern; the
[packaging stage](agent-system-plan.md#p1-version-local-package-guidance) is not
implemented by adding repository documents.

## spikes/

One-off measurement write-ups, kept for their numbers. Each records
the measurement, the Chrome version, and the date. They are not plans;
some predate designs that later changed shape. `design-language.html`
is a visual reference sheet for the lab; open it in a browser.
