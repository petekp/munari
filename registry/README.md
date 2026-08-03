# registry/ — copyable behaviors

The shadcn model: nothing in here is published. A registry entry is
vendorable source that travels with two things it is never separated
from — its **tuned constants** and its **perceptual-floor tests**
(budgets pinned to real hand speeds, the named peers of the theorems).

**glass/** is the first shipped pack: the SDF compositor as vendorable
source, byte-welded to Lab 012, with the capillary law's TS twin and
the view-space-z ordering regression
(`tests/registry/glassPack.test.ts`).

**flight-card/** is a charter, deliberately: the laws are kernel
contracts, the scene machinery is one organism inside Lab 014, and
extraction waits for a second consumer (decisions.md #10). Its README
is the inventory; the pack test welds the charter's claims to the
kernel and the reference scene.

Still planned: the control kit — `Dial` already ships from the binding;
Toggle and Slider wait for a consuming lab.

Focus and spatial navigation deliberately do NOT live here
(decisions.md #9): the mechanism ships as exported API from the
binding, so a copyable duplicate would be a second source of truth for
one behavior. Its evidence rides beside the modules instead, at
`packages/react/src/lib/*.test.ts`, with `docs/focus.md` as the
contract doc. Import-code, not copy-code.

Registry code imports the library only through the `anamorph` barrel —
if a behavior can't be built without patching the kernel, that is a
kernel bug, not a registry workaround.
