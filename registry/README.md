# registry/ — copyable behaviors

The shadcn model: nothing in here is published. A registry entry is
vendorable source that travels with two things it is never separated
from — its **tuned constants** and its **perceptual-floor tests**
(budgets pinned to real hand speeds, the named peers of the theorems).

**glass/** is the first shipped pack: the SDF compositor as vendorable
source, byte-welded to the glass scene, with the capillary law's TS twin and
the view-space-z ordering regression
(`tests/registry/glassPack.test.ts`).

**flight-card/** is a charter, deliberately: the laws are kernel
contracts, the scene machinery is one organism inside the flight scene, and
extraction waits for a second consumer (decisions.md #10). Its README
is the inventory; the pack test welds the charter's claims to the
kernel and the reference scene.

**surface-anchors/** is the keyed source-UV collector used by Knobs and
Genie. Its vendorable file is byte-welded to the lab module and keeps
attachment identity tied to a successful DOM paint receipt.

Nothing else is planned *here* — the doctrine above is the whole
admission rule, and a pack that no consumer has asked for would be a
second system. Ideas waiting on a consumer (a Toggle/Slider control kit
to join `Dial`, extracting flight-card) are tracked as issues, not as
entries in this file.

Focus and spatial navigation deliberately do NOT live here
(decisions.md #9): the mechanism ships as exported API from the
binding, so a copyable duplicate would be a second source of truth for
one behavior. Its evidence rides beside the modules instead, at
`packages/react/src/lib/*.test.ts`, with `docs/focus.md` as the
contract doc. Import-code, not copy-code.

Registry code imports the library only through the `@petepetrash/munari` barrel —
if a behavior can't be built without patching the kernel, that is a
kernel bug, not a registry workaround.
